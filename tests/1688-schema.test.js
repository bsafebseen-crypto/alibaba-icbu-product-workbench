import test from 'node:test';
import assert from 'node:assert/strict';

import {
  build1688PublishRequest,
  merge1688SubSchema,
  parse1688Schema,
  preflight1688Product,
  sceneFor1688Category,
} from '../src/1688-schema.js';

function sampleSchema() {
  return {
    global: { systemParam: { catId: 1031910, contextPath: '/popular' } },
    fields: {
      title: {
        name: 'title', type: 'input', label: '商品标题', required: true, maxLength: 60,
      },
      beginAmount: {
        name: 'beginAmount', type: 'inputNumber', label: '起批量', required: true, minimum: 1,
      },
      primaryPicture: {
        name: 'primaryPicture', type: 'image', label: '商品主图', required: true, maxItems: 5,
      },
      hiddenValue: {
        name: 'hiddenValue', type: 'input', label: '隐藏字段', required: true, visible: false,
      },
      readonlyValue: {
        name: 'readonlyValue', type: 'input', label: '只读字段', required: true, readonly: true,
      },
    },
  };
}

test('sceneFor1688Category maps official category types and processing mode', () => {
  assert.equal(sceneFor1688Category({ categoryType: 1 }), 'cbu');
  assert.equal(sceneFor1688Category({ categoryType: '2' }), 'industry');
  assert.equal(sceneFor1688Category({ categoryType: 3 }), 'popular');
  assert.equal(sceneFor1688Category({ categoryType: 1 }, { processing: true }), 'processing');
  assert.throws(() => sceneFor1688Category({ categoryType: 9 }), /不支持的 1688 类目类型/);
});

test('parse1688Schema accepts the official nested bizData string and exposes safe field rules', () => {
  const parsed = parse1688Schema({
    result: { success: true, bizCode: '', bizMsg: '', bizData: JSON.stringify(sampleSchema()) },
  });

  assert.deepEqual(parsed.global, sampleSchema().global);
  assert.match(parsed.hash, /^[a-f0-9]{64}$/);
  assert.deepEqual(parsed.fields.map((field) => ({
    path: field.path,
    type: field.type,
    required: field.required,
    visible: field.visible,
    readonly: field.readonly,
  })), [
    { path: 'title', type: 'input', required: true, visible: true, readonly: false },
    { path: 'beginAmount', type: 'inputNumber', required: true, visible: true, readonly: false },
    { path: 'primaryPicture', type: 'image', required: true, visible: true, readonly: false },
    { path: 'hiddenValue', type: 'input', required: true, visible: false, readonly: false },
    { path: 'readonlyValue', type: 'input', required: true, visible: true, readonly: true },
  ]);
});

test('parse1688Schema rejects unsuccessful business responses and malformed JSON', () => {
  assert.throws(() => parse1688Schema({
    result: { success: false, bizCode: 'NO_PERMISSION', bizMsg: '没有方案权限' },
  }), (error) => error.code === 'NO_PERMISSION' && /没有方案权限/.test(error.message));
  assert.throws(() => parse1688Schema({
    result: { success: true, bizData: '{broken' },
  }), /Schema 返回不是有效 JSON/);
});

test('merge1688SubSchema replaces matching fields and changes the schema hash', () => {
  const base = parse1688Schema({ result: { success: true, bizData: JSON.stringify(sampleSchema()) } });
  const merged = merge1688SubSchema(base, {
    result: {
      success: true,
      bizData: JSON.stringify({
        fields: {
          beginAmount: {
            name: 'beginAmount', type: 'inputNumber', label: '起批量', required: true, minimum: 5,
          },
          sellUnit: {
            name: 'sellUnit', type: 'enumText', label: '销售单位', required: true,
            dataSource: ['件', '箱'],
          },
        },
      }),
    },
  });

  assert.notEqual(merged.hash, base.hash);
  assert.equal(merged.fields.find((field) => field.path === 'beginAmount').minimum, 5);
  assert.deepEqual(merged.fields.find((field) => field.path === 'sellUnit').dataSource, ['件', '箱']);
});

test('preflight1688Product reports required, length, range and image-count errors', () => {
  const schema = parse1688Schema({ result: { success: true, bizData: JSON.stringify(sampleSchema()) } });
  const result = preflight1688Product(schema, {
    title: 'A'.repeat(61),
    beginAmount: 0,
    primaryPicture: { imageList: [] },
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.map(({ path, code }) => [path, code]), [
    ['title', 'MAX_LENGTH'],
    ['beginAmount', 'MINIMUM'],
    ['primaryPicture', 'REQUIRED'],
  ]);
  assert.equal(result.errors.some(({ path }) => path === 'hiddenValue'), false);
  assert.equal(result.errors.some(({ path }) => path === 'readonlyValue'), false);
});

test('preflight1688Product blocks an unsupported required component', () => {
  const raw = sampleSchema();
  raw.fields.complianceWidget = {
    name: 'complianceWidget', type: 'future_compliance_widget', label: '行业合规组件', required: true,
  };
  const schema = parse1688Schema({ result: { success: true, bizData: JSON.stringify(raw) } });
  const result = preflight1688Product(schema, {
    title: '测试商品', beginAmount: 2, primaryPicture: { imageList: [{ url: 'https://img.example/1.jpg' }] },
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.unsupported, [{
    path: 'complianceWidget', label: '行业合规组件', type: 'future_compliance_widget',
  }]);
});

test('build1688PublishRequest creates a deterministic safe summary and fingerprint', () => {
  const schemaA = parse1688Schema({ result: { success: true, bizData: JSON.stringify(sampleSchema()) } });
  const reordered = {
    fields: sampleSchema().fields,
    global: sampleSchema().global,
  };
  const schemaB = parse1688Schema({ result: { success: true, bizData: JSON.stringify(reordered) } });
  const formValues = {
    cargoNumber: 'WB-001',
    primaryPicture: { imageList: [{ url: 'https://img.example/1.jpg' }] },
    beginAmount: 2,
    title: '测试商品',
    skuTable: [{ sku_cargoNumber: 'WB-001', sku_price: 12.5, sku_amountOnSale: 20 }],
    accessToken: 'must-not-leak',
  };

  const first = build1688PublishRequest({
    schema: schemaA, catId: 1031910, scene: 'popular', formValues,
  });
  const second = build1688PublishRequest({
    schema: schemaB, catId: 1031910, scene: 'popular',
    formValues: { ...formValues, title: '测试商品' },
  });

  assert.equal(first.preflight.valid, true);
  assert.equal(first.fingerprint, second.fingerprint);
  assert.match(first.fingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(first.dataBody.global, sampleSchema().global);
  assert.equal(first.dataBody.formValues.accessToken, undefined);
  assert.deepEqual(first.summary, {
    method: 'alibaba.new.product.add',
    catId: '1031910',
    scene: 'popular',
    fieldCount: 5,
    skuCount: 1,
    imageCount: 1,
    schemaHash: schemaA.hash,
  });
  assert.equal(JSON.stringify(first).includes('must-not-leak'), false);
});

test('build1688PublishRequest requires a cargo number for uncertain-result reconciliation', () => {
  const schema = parse1688Schema({ result: { success: true, bizData: JSON.stringify(sampleSchema()) } });
  const result = build1688PublishRequest({
    schema,
    catId: 1031910,
    scene: 'popular',
    formValues: {
      title: '测试商品',
      beginAmount: 2,
      primaryPicture: { imageList: [{ url: 'https://img.example/1.jpg' }] },
    },
  });

  assert.equal(result.preflight.valid, false);
  assert.deepEqual(result.preflight.errors.at(-1), {
    path: 'cargoNumber',
    label: '货号',
    code: 'RECONCILIATION_REQUIRED',
    message: '货号为必填项，用于发布结果不确定时只读核验',
  });
});

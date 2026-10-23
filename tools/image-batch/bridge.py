"""NDJSON adapter for the existing local image processor."""

import json
import os
from pathlib import Path
import sys

sys.dont_write_bytecode = True


def emit(event):
    print(json.dumps(event, ensure_ascii=False), flush=True)


def selected_folder(payload):
    value = payload.get('folder')
    if not isinstance(value, str) or not value.strip():
        raise ValueError('请先选择一个存在的本地图片文件夹。')
    folder = Path(value).resolve(strict=True)
    if not folder.is_dir():
        raise ValueError('请选择一个存在的本地图片文件夹。')
    return folder


def main():
    if sys.version_info < (3, 10):
        raise RuntimeError('需要 Python 3.10 或以上版本。')
    try:
        import PIL
        import tkinter
        from tkinter import filedialog
        from image_processor import find_images, process_folder
    except ImportError as error:
        raise RuntimeError(
            '需要带 tkinter 的 Python 3.10 或以上版本及 Pillow。'
            '请执行：py -3 -m pip install -r tools/image-batch/requirements.txt'
        ) from error

    action = sys.argv[1] if len(sys.argv) == 2 else ''
    payload = json.load(sys.stdin)
    if action == 'check':
        emit({'type': 'ready', 'python': sys.version.split()[0], 'pillow': PIL.__version__})
    elif action == 'select':
        root = tkinter.Tk()
        root.withdraw()
        root.attributes('-topmost', True)
        try:
            chosen = filedialog.askdirectory(
                parent=root, title='选择需要原地覆盖的图片文件夹', mustexist=True,
            )
        finally:
            root.destroy()
        folder = Path(chosen).resolve(strict=True) if chosen else None
        emit({'type': 'selection', 'folder': str(folder) if folder else None,
              'count': len(find_images(folder)) if folder else 0})
    elif action == 'process':
        folder = selected_folder(payload)
        result = process_folder(folder, lambda done, total, name: emit({
            'type': 'progress', 'done': done, 'total': total, 'name': name,
        }))
        emit({'type': 'result', 'folder': str(result.output_folder),
              'completed': result.completed, 'skipped': result.skipped})
    elif action == 'open':
        folder = selected_folder(payload)
        if sys.platform != 'win32':
            raise RuntimeError('当前仅支持在 Windows 资源管理器中打开文件夹。')
        os.startfile(str(folder))
        emit({'type': 'opened'})
    else:
        raise ValueError('不支持的图片工具操作。')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        emit({'type': 'error', 'message': str(error) or '本地图片工具未能完成操作。'})
        sys.exit(1)

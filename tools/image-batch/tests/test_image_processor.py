import hashlib
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from image_processor import find_images, process_folder


class ProcessingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='图片测试 ')
        self.folder = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def image(self, name, color='red', size=(20, 20)):
        path = self.folder / name
        Image.new('RGB', size, color).save(path)
        return path

    def test_natural_order_dimensions_and_in_place_replacement(self):
        self.image('产品10.png', 'blue')
        self.image('产品2.png', 'green', (90, 40))
        self.image('产品1.png', 'red', (30, 80))
        (self.folder / '说明.txt').write_text('保留', encoding='utf-8')
        nested = self.folder / '子文件夹'
        nested.mkdir()
        Image.new('RGB', (10, 10), 'yellow').save(nested / '0.png')
        self.assertEqual([p.name for p in find_images(self.folder)],
                         ['产品1.png', '产品2.png', '产品10.png'])
        events = []
        result = process_folder(self.folder, lambda *event: events.append(event))
        self.assertEqual(result.output_folder, self.folder)
        self.assertEqual(result.completed, 3)
        self.assertEqual(result.skipped, [])
        self.assertEqual(sorted(p.name for p in self.folder.iterdir()),
                         ['1.jpg', '2.jpg', '3.jpg', '子文件夹', '说明.txt'])
        for number, dominant_channel in [(1, 0), (2, 1), (3, 2)]:
            with Image.open(result.output_folder / f'{number}.jpg') as image:
                self.assertEqual(image.size, (800, 800))
                self.assertEqual(image.mode, 'RGB')
                pixel = image.getpixel((400, 400))
                self.assertEqual(pixel.index(max(pixel)), dominant_channel)
        self.assertEqual([(e[0], e[1]) for e in events], [(1, 3), (2, 3), (3, 3)])
        self.assertEqual((self.folder / '说明.txt').read_text(encoding='utf-8'), '保留')
        with Image.open(nested / '0.png') as image:
            self.assertEqual(image.size, (10, 10))

    def test_repeat_runs_replace_numbered_files_without_extra_folders(self):
        self.image('1.jpg')
        self.image('2.png', 'blue')
        first = process_folder(self.folder)
        second = process_folder(self.folder)
        self.assertEqual(first.output_folder, second.output_folder)
        self.assertEqual(second.completed, 2)
        self.assertEqual(sorted(p.name for p in self.folder.iterdir()), ['1.jpg', '2.jpg'])
        with Image.open(self.folder / '2.jpg') as image:
            self.assertGreater(image.getpixel((400, 400))[2], 240)

    def test_corrupt_images_are_skipped_and_numbering_has_no_gaps(self):
        self.image('1.png')
        bad = b'not an image'
        (self.folder / '2.png').write_bytes(bad)
        self.image('3.png', 'blue')
        result = process_folder(self.folder)
        self.assertEqual(result.completed, 2)
        self.assertEqual([name for name, error in result.skipped], ['2.png'])
        self.assertEqual(sorted(p.name for p in result.output_folder.iterdir()),
                         ['1.jpg', '2.jpg', '2.png'])
        self.assertEqual((self.folder / '2.png').read_bytes(), bad)

    def test_transparent_pixels_have_white_background(self):
        image = Image.new('RGBA', (20, 20), (0, 0, 0, 0))
        image.paste((255, 0, 0, 255), (0, 0, 10, 20))
        image.save(self.folder / '透明.png')
        result = process_folder(self.folder)
        with Image.open(result.output_folder / '1.jpg') as output:
            self.assertTrue(all(c > 245 for c in output.getpixel((700, 400))))
            self.assertGreater(output.getpixel((100, 400))[0], 240)

    def test_exif_orientation_is_applied_before_resizing(self):
        image = Image.new('RGB', (40, 20), 'blue')
        image.paste('red', (0, 0, 20, 20))
        exif = Image.Exif()
        exif[274] = 6
        image.save(self.folder / '手机照片.png', exif=exif)
        result = process_folder(self.folder)
        with Image.open(result.output_folder / '1.jpg') as output:
            top = output.getpixel((400, 100))
            bottom = output.getpixel((400, 700))
            self.assertGreater(top[0], 240)
            self.assertGreater(bottom[2], 240)
            self.assertNotIn(274, output.getexif())

    def test_common_formats_and_first_frame_export(self):
        self.image('1.BMP')
        self.image('2.webp')
        Image.new('CMYK', (20, 20), (0, 255, 255, 0)).save(self.folder / '3.jpeg')
        frames = [Image.new('RGB', (20, 20), color) for color in ('red', 'blue')]
        frames[0].save(self.folder / '4.gif', save_all=True, append_images=frames[1:])
        frames[0].save(self.folder / '5.tiff', save_all=True, append_images=frames[1:])
        result = process_folder(self.folder)
        self.assertEqual(result.completed, 5)
        for name in ('4.jpg', '5.jpg'):
            with Image.open(result.output_folder / name) as output:
                self.assertGreater(output.getpixel((400, 400))[0], 240)

    def test_empty_folder_does_not_create_results(self):
        with self.assertRaises(ValueError):
            process_folder(self.folder)
        self.assertEqual(list(self.folder.iterdir()), [])

    def test_invalid_folder_is_rejected(self):
        with self.assertRaises(ValueError):
            find_images(self.folder / '不存在')

    def snapshot(self):
        return {path.name: hashlib.sha256(path.read_bytes()).hexdigest()
                for path in self.folder.iterdir() if path.is_file()}

    def test_corrupt_numbered_target_aborts_without_changing_sources(self):
        self.image('2.png')
        (self.folder / '1.jpg').write_bytes(b'corrupt numbered image')
        before = self.snapshot()
        with self.assertRaises(FileExistsError):
            process_folder(self.folder)
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(sorted(p.name for p in self.folder.iterdir()), ['1.jpg', '2.png'])

    def test_numbered_directory_is_not_overwritten(self):
        self.image('photo.png')
        (self.folder / '1.jpg').mkdir()
        with self.assertRaises(FileExistsError):
            process_folder(self.folder)
        self.assertTrue((self.folder / 'photo.png').is_file())
        self.assertTrue((self.folder / '1.jpg').is_dir())
        self.assertEqual(len(list(self.folder.iterdir())), 2)

    def test_all_corrupt_images_leave_no_temporary_folder(self):
        (self.folder / '1.jpg').write_bytes(b'broken')
        before = self.snapshot()
        result = process_folder(self.folder)
        self.assertEqual(result.completed, 0)
        self.assertEqual(len(result.skipped), 1)
        self.assertEqual(self.snapshot(), before)
        self.assertEqual([p.name for p in self.folder.iterdir()], ['1.jpg'])

    def test_staging_write_failure_leaves_all_originals_untouched(self):
        self.image('1.jpg')
        self.image('2.png', 'blue')
        before = self.snapshot()
        with patch.object(Image.Image, 'save', side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                process_folder(self.folder)
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(sorted(p.name for p in self.folder.iterdir()), ['1.jpg', '2.png'])

    def test_failed_source_move_restores_original_names_and_contents(self):
        self.image('1.jpg')
        self.image('2.png', 'blue')
        before = self.snapshot()
        rename = Path.rename

        def fail_source_move(path, target):
            if path == self.folder / '2.png':
                raise PermissionError('source is locked')
            return rename(path, target)

        with patch.object(Path, 'rename', new=fail_source_move):
            with self.assertRaises(OSError):
                process_folder(self.folder)
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(sorted(p.name for p in self.folder.iterdir()), ['1.jpg', '2.png'])

    def test_failed_output_install_restores_original_names_and_contents(self):
        self.image('1.jpg')
        self.image('2.png', 'blue')
        before = self.snapshot()
        rename = Path.rename

        def fail_output_install(path, target):
            if path.parent.name == 'converted' and Path(target).name == '2.jpg':
                raise PermissionError('destination is locked')
            return rename(path, target)

        with patch.object(Path, 'rename', new=fail_output_install):
            with self.assertRaises(OSError):
                process_folder(self.folder)
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(sorted(p.name for p in self.folder.iterdir()), ['1.jpg', '2.png'])

    def test_incomplete_rollback_keeps_recoverable_originals(self):
        first = self.image('1.jpg').read_bytes()
        self.image('2.png', 'blue')
        rename = Path.rename

        def fail_install_and_restore(path, target):
            if path.parent.name == 'converted' and Path(target).name == '2.jpg':
                raise PermissionError('install locked')
            if path.parent.name == 'originals' and path.name == '1.jpg':
                raise PermissionError('restore locked')
            return rename(path, target)

        with patch.object(Path, 'rename', new=fail_install_and_restore):
            with self.assertRaises(OSError) as caught:
                process_folder(self.folder)
        stages = [p for p in self.folder.iterdir() if p.is_dir()]
        self.assertEqual(len(stages), 1)
        self.assertIn(str(stages[0]), str(caught.exception))
        self.assertEqual((stages[0] / 'originals' / '1.jpg').read_bytes(), first)
        self.assertTrue((self.folder / '2.png').is_file())

    def test_cleanup_failure_after_commit_does_not_rollback_outputs(self):
        self.image('1.jpg', size=(20, 20))
        with patch('shutil.rmtree', side_effect=PermissionError('cleanup locked')):
            with self.assertRaises(OSError) as caught:
                process_folder(self.folder)
        with Image.open(self.folder / '1.jpg') as output:
            self.assertEqual(output.size, (800, 800))
        stages = [p for p in self.folder.iterdir() if p.is_dir()]
        self.assertEqual(len(stages), 1)
        self.assertIn(str(stages[0]), str(caught.exception))
        with Image.open(stages[0] / 'originals' / '1.jpg') as original:
            self.assertEqual(original.size, (20, 20))


if __name__ == '__main__':
    unittest.main()

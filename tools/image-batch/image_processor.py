"""Resize and renumber images in place, staging changes before replacement."""

from dataclasses import dataclass
from pathlib import Path
import re
import shutil
import tempfile
from typing import Callable

from PIL import Image, ImageOps, UnidentifiedImageError


SUPPORTED_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tif', '.tiff', '.gif'}


@dataclass
class BatchResult:
    output_folder: Path
    completed: int
    skipped: list[tuple[str, str]]


def find_images(folder: Path) -> list[Path]:
    folder = Path(folder)
    if not folder.is_dir():
        raise ValueError('请选择一个存在的本地文件夹。')

    def natural_key(path: Path):
        parts = [int(part) if part.isdecimal() else part.casefold()
                 for part in re.split(r'(\d+)', path.name)]
        return parts, path.name

    return sorted((path for path in folder.iterdir()
                   if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS),
                  key=natural_key)


def _remove_stage(stage: Path, folder: Path) -> None:
    if stage.resolve().parent != folder.resolve() or not stage.name.startswith('.image_batch_'):
        raise OSError(f'临时目录位置异常，未清理：{stage}')
    shutil.rmtree(stage)


def process_folder(
    folder: Path,
    progress: Callable[[int, int, str], None] | None = None,
) -> BatchResult:
    folder = Path(folder)
    files = find_images(folder)
    if not files:
        raise ValueError('文件夹中没有支持的图片，请选择含 JPG、PNG 等图片的文件夹。')

    stage = Path(tempfile.mkdtemp(prefix='.image_batch_', dir=folder))
    converted = stage / 'converted'
    originals = stage / 'originals'
    prepared = []
    moved = []
    installed = []
    skipped = []
    try:
        converted.mkdir()
        originals.mkdir()
        for attempted, path in enumerate(files, start=1):
            try:
                with Image.open(path) as original:
                    original.seek(0)
                    image = ImageOps.exif_transpose(original)
                    if image.mode in ('RGBA', 'LA', 'PA') or 'transparency' in image.info:
                        rgba = image.convert('RGBA')
                        rgb = Image.new('RGB', rgba.size, 'white')
                        rgb.paste(rgba, mask=rgba.getchannel('A'))
                    else:
                        rgb = image.convert('RGB')
                    resized = rgb.resize((800, 800), Image.Resampling.LANCZOS)
            except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as error:
                skipped.append((path.name, str(error)))
            else:
                with (converted / f'{len(prepared) + 1}.jpg').open('xb') as stream:
                    resized.save(stream, format='JPEG', quality=95, subsampling=0)
                prepared.append(path)
            if progress is not None:
                progress(attempted, len(files), path.name)

        for number in range(1, len(prepared) + 1):
            destination = folder / f'{number}.jpg'
            if (destination.exists() or destination.is_symlink()) and destination not in prepared:
                raise FileExistsError(
                    f'无法使用文件名 {destination.name}：已有同名文件或文件夹，且它不是可替换的图片。'
                    '\n原图片尚未修改，请先移走该同名项目再试。'
                )

        # Move every source aside before installing outputs whose names may overlap.
        for path in prepared:
            backup = originals / path.name
            path.rename(backup)
            moved.append((path, backup))
        for number in range(1, len(prepared) + 1):
            destination = folder / f'{number}.jpg'
            (converted / destination.name).rename(destination)
            installed.append(destination)
    except Exception as error:
        recovery_errors = []
        for destination in reversed(installed):
            try:
                destination.unlink()
            except OSError as recovery_error:
                recovery_errors.append(str(recovery_error))
        for path, backup in reversed(moved):
            try:
                backup.rename(path)
            except OSError as recovery_error:
                recovery_errors.append(str(recovery_error))
        if recovery_errors:
            raise OSError(
                f'处理失败，部分原图片未能自动恢复。请勿删除临时目录：{stage}'
                f'\n尚未恢复的原图保存在：{originals}\n{error}'
            ) from error
        try:
            _remove_stage(stage, folder)
        except OSError as cleanup_error:
            raise OSError(
                f'处理未完成，原图片已恢复；临时目录无法清理：{stage}\n{error}'
            ) from cleanup_error
        raise

    # All outputs are installed. Never roll back after deleting any backup.
    try:
        _remove_stage(stage, folder)
    except OSError as error:
        raise OSError(
            f'图片已全部修改完成，但临时目录无法清理：{stage}\n{error}'
        ) from error
    return BatchResult(folder, len(prepared), skipped)

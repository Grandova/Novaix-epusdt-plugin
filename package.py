import hashlib
import json
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parent
manifest = json.loads((root / "plugin/manifest.json").read_text(encoding="utf-8"))
output = root / "dist"
output.mkdir(exist_ok=True)
plugin = output / f"{manifest['id']}-{manifest['version']}.zip"
with zipfile.ZipFile(plugin, "w", zipfile.ZIP_DEFLATED) as archive:
    for name in ("manifest.json", "main.js"):
        archive.write(root / "plugin" / name, name)
source = output / f"novaix-epusdt-{manifest['version']}-source.zip"
with zipfile.ZipFile(source, "w", zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root)
        if path.is_file() and not any(part in ("dist", "__pycache__", ".git") for part in relative.parts):
            archive.write(path, relative.as_posix())
for path in (plugin, source):
    with zipfile.ZipFile(path) as archive:
        if archive.testzip() is not None:
            raise RuntimeError(f"损坏的压缩包：{path}")
(output / "SHA256SUMS.txt").write_text("".join(hashlib.sha256(p.read_bytes()).hexdigest() + "  " + p.name + "\n" for p in (plugin, source)), encoding="utf-8")
print(plugin)
print(source)

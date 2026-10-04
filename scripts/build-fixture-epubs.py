import base64, os, re, subprocess, sys, zipfile
CONTAINER = '''<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
	<rootfiles>
		<rootfile full-path="epub/content.opf" media-type="application/oebps-package+xml"/>
	</rootfiles>
</container>
'''
out_dir = sys.argv[1]
for repo, name in [
    ("robert-louis-stevenson_the-strange-case-of-dr-jekyll-and-mr-hyde", "stevenson-jekyll-and-hyde.epub"),
    ("mary-shelley_frankenstein", "shelley-frankenstein.epub"),
    ("h-g-wells_the-time-machine", "wells-the-time-machine.epub"),
]:
    src = os.path.join(repo, "src", "epub")
    svg = open(os.path.join(src, "images", "cover.svg"), encoding="utf-8").read()
    # Shrink the embedded painting so the fixture stays small.
    small = subprocess.run(["convert", os.path.join(repo, "images", "cover.jpg"), "-resize", "350x525", "-quality", "72", "jpg:-"], capture_output=True, check=True).stdout
    svg = re.sub(r'data:image/jpeg;base64,[A-Za-z0-9+/=\s]+', "data:image/jpeg;base64," + base64.b64encode(small).decode(), svg, count=1)
    path = os.path.join(out_dir, name)
    with zipfile.ZipFile(path, "w") as z:
        z.writestr(zipfile.ZipInfo("mimetype"), "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        z.writestr("META-INF/container.xml", CONTAINER, compress_type=zipfile.ZIP_DEFLATED)
        for root, _, files in os.walk(src):
            for f in sorted(files):
                full = os.path.join(root, f)
                arc = "epub/" + os.path.relpath(full, src).replace(os.sep, "/")
                if arc == "epub/images/cover.svg":
                    z.writestr(arc, svg, compress_type=zipfile.ZIP_DEFLATED)
                else:
                    z.write(full, arc, compress_type=zipfile.ZIP_DEFLATED)
    print(name, os.path.getsize(path))

import { describe, expect, it } from "vitest";
import { DriveError, filesInFolderView, nameFromDisposition, parseDriveLink, PublicDrive } from "./drive";

const FILE = "1AbCdEfGhIjKlMnOpQrStUv";
const FOLDER = "1ZyXwVuTsRqPoNmLkJiHgF";

describe("Google Drive links (M30)", () => {
  it("reads file and folder links in their usual shapes", () => {
    expect(parseDriveLink(`https://drive.google.com/file/d/${FILE}/view?usp=sharing`)).toEqual({ kind: "file", id: FILE });
    expect(parseDriveLink(`https://drive.google.com/open?id=${FILE}`)).toEqual({ kind: "file", id: FILE });
    expect(parseDriveLink(`https://drive.google.com/uc?id=${FILE}&export=download`)).toEqual({ kind: "file", id: FILE });
    expect(parseDriveLink(`https://drive.usercontent.google.com/download?id=${FILE}`)).toEqual({ kind: "file", id: FILE });
    expect(parseDriveLink(`https://drive.google.com/drive/folders/${FOLDER}?usp=sharing`)).toEqual({ kind: "folder", id: FOLDER });
    expect(parseDriveLink(`  https://drive.google.com/drive/u/0/folders/${FOLDER}  `)).toEqual({ kind: "folder", id: FOLDER });
  });

  it("refuses anything that is not a Drive link on Google's own hosts", () => {
    for (const bad of [
      "not a link",
      `http://drive.google.com/file/d/${FILE}/view`,
      `https://drive.google.com.evil.example/file/d/${FILE}/view`,
      `https://example.org/file/d/${FILE}/view`,
      "https://drive.google.com/file/d/short/view",
      "https://drive.google.com/drive/my-drive",
    ])
      expect(parseDriveLink(bad), bad).toBeNull();
  });

  it("lists the files of a public folder view, not its subfolders, with names as shown", () => {
    const html = `<div class="flip-entries">
      <div class="flip-entry" id="entry-${FILE}" tabindex="0"><div class="flip-entry-info"><a href="https://drive.google.com/file/d/${FILE}/view?usp=drive_web"><div class="flip-entry-title">Kuhn &amp; Friends.pdf</div></a></div></div>
      <div class="flip-entry" id="entry-${FOLDER}" tabindex="0"><div class="flip-entry-info"><a href="https://drive.google.com/drive/folders/${FOLDER}"><div class="flip-entry-title">Old books</div></a></div></div>
    </div>`;
    expect(filesInFolderView(html)).toEqual([{ id: FILE, name: "Kuhn & Friends.pdf" }]);
  });

  it("takes the file name from the download's header", () => {
    expect(nameFromDisposition('attachment; filename="Kuhn-SSR-2ndEd-2.pdf"')).toBe("Kuhn-SSR-2ndEd-2.pdf");
    expect(nameFromDisposition("attachment; filename*=UTF-8''Caf%C3%A9%20book.epub")).toBe("Café book.epub");
    expect(nameFromDisposition(null)).toBeNull();
  });

  it("downloads a shared file, and explains a file that is not shared or too large", async () => {
    const asked: string[] = [];
    const drive = new PublicDrive((async (url: string) => {
      asked.push(url);
      if (url.includes(FILE))
        return new Response(new Uint8Array([37, 80, 68, 70, 45]), { headers: { "content-type": "application/octet-stream", "content-disposition": 'attachment; filename="book.pdf"' } });
      return new Response("<html>Sign in</html>", { headers: { "content-type": "text/html; charset=UTF-8" } });
    }) as unknown as typeof fetch);
    const got = await drive.download(FILE, 1000);
    expect(got.name).toBe("book.pdf");
    expect([...got.bytes]).toEqual([37, 80, 68, 70, 45]);
    expect(asked[0]).toBe(`https://drive.usercontent.google.com/download?id=${FILE}&export=download&confirm=t`);
    await expect(drive.download(FOLDER, 1000)).rejects.toThrow(/Anyone with the link/);
    await expect(drive.download(FILE, 3)).rejects.toThrow(DriveError);
    await expect(drive.download("../../etc", 10)).rejects.toThrow("That is not a Google Drive file link.");
  });
});

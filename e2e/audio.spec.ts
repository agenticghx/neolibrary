import { expect, test } from "@playwright/test";
import { ADMIN_STATE } from "./pages";

// M7 (a): reading aloud through the API, with the fake voice (AI_FAKE=1 in
// the test server). The player in the reader comes next.

test.use({ storageState: ADMIN_STATE });

test("a paragraph is read aloud once, stored with word timings, and its audio is only for its owner", async ({ page, browser }) => {
  await page.goto(`/search?q=${encodeURIComponent('"lover of the sane and customary"')}`);
  const link = page.getByRole("region", { name: /The Strange Case/ }).getByRole("link").filter({ hasText: "lover" }).first();
  const href = (await link.getAttribute("href"))!;
  const [, bookId, cfi] = /\/books\/([0-9a-f-]{36})\/read\?at=(.+)$/.exec(href)!;

  const info = await (await page.request.get(`/api/books/${bookId}/audio?cfi=${cfi}`)).json();
  expect(info.voices).toEqual([
    { id: "fake-ada", name: "Ada (test voice)" },
    { id: "fake-ben", name: "Ben (test voice)" },
  ]);
  expect(info.track).toBeNull();
  expect(info.estimate).toBeGreaterThan(0);
  expect(info.passage.nextId).toEqual(expect.any(String));

  const made = await page.request.post(`/api/books/${bookId}/audio`, { data: { sectionId: info.passage.id, voice: "fake-ada" } });
  expect(made.status()).toBe(201);
  const { track } = await made.json();
  expect(track).toMatchObject({ sectionId: info.passage.id, voice: "fake-ada", mime: "audio/wav", provider: "elevenlabs", model: "fake-voice" });
  expect(track.words.length).toBeGreaterThan(50);
  expect(track.durationMs).toBeGreaterThan(1000);

  // Asked again: the stored track, no new audio.
  const again = await page.request.post(`/api/books/${bookId}/audio`, { data: { sectionId: info.passage.id, voice: "fake-ada" } });
  expect(again.status()).toBe(200);
  expect((await again.json()).track.id).toBe(track.id);
  expect((await (await page.request.get(`/api/books/${bookId}/audio?cfi=${cfi}&voice=fake-ada`)).json()).track.id).toBe(track.id);

  const audio = await page.request.get(track.audioUrl);
  expect(audio.status()).toBe(200);
  expect(audio.headers()["content-type"]).toBe("audio/wav");
  expect((await audio.body()).subarray(0, 4).toString()).toBe("RIFF");

  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  expect((await anon.request.get(new URL(track.audioUrl, page.url()).href)).status()).toBe(401);
  expect((await anon.request.post(new URL(`/api/books/${bookId}/audio`, page.url()).href, { data: {} })).status()).toBe(401);
  await anon.close();
  expect((await page.request.post(`/api/books/${bookId}/audio`, { data: { sectionId: info.passage.id, voice: "nobody" } })).status()).toBe(400);
});

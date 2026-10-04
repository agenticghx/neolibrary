import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { listAnnotations } from "@/lib/library/annotations";
import { importBook } from "@/lib/library/import";
import { MemoryStorage } from "@/lib/storage";
import { buildMcpServer } from "./mcp";

let database: Database;
let ownerId: string;
let jekyll: string;
let client: Client;

beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  const bytes = new Uint8Array(readFileSync(new URL("../../fixtures/books/stevenson-jekyll-and-hyde.epub", import.meta.url)));
  jekyll = (await importBook(database.db, new MemoryStorage(), ownerId, { name: "jh.epub", bytes })).bookId;
  const [a, b] = InMemoryTransport.createLinkedPair();
  await buildMcpServer(database.db, ownerId, "MCP test agent").connect(a);
  client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(b);
});
afterEach(async () => {
  await client.close();
  await database.raw.close();
});

const call = async (name: string, args: Record<string, unknown>) => {
  const r = (await client.callTool({ name, arguments: args })) as { content: { type: string; text: string }[]; isError?: boolean };
  return { error: r.isError ?? false, text: r.content[0].text, json: () => JSON.parse(r.content[0].text) };
};

describe("MCP server (M11)", () => {
  it("offers the four tools, with descriptions and input schemas", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["add_note", "get_notes", "list_books", "search_text"]);
    const add = tools.find((t) => t.name === "add_note")!;
    expect(add.description).toContain("marked as written by this agent");
    expect(add.inputSchema.required).toEqual(["bookId", "text"]);
    expect(tools.find((t) => t.name === "search_text")!.annotations?.readOnlyHint).toBe(true);
  });

  it("lists books, searches, adds a note on a paragraph and reads it back, marked with the agent", async () => {
    expect((await call("list_books", {})).json().books).toEqual([expect.objectContaining({ id: jekyll, title: "The Strange Case of Dr. Jekyll and Mr. Hyde" })]);
    const [hit] = (await call("search_text", { query: '"Next they turned to the business table"', limit: 1 })).json().results;
    expect(hit.text).toContain("**");
    const added = (await call("add_note", { bookId: jekyll, text: "Found by MCP.", sectionId: hit.sectionId })).json().note;
    expect(added).toMatchObject({ addedByAgent: "MCP test agent", sectionId: hit.sectionId, kind: "highlight" });
    expect((await call("get_notes", { bookId: jekyll })).json().notes).toEqual([expect.objectContaining({ note: "Found by MCP.", addedByAgent: "MCP test agent" })]);
    expect((await listAnnotations(database.db, ownerId, jekyll))[0]).toMatchObject({ body: "Found by MCP.", agent: "MCP test agent" });
  });

  it("explains mistakes to the model instead of failing", async () => {
    const missing = await call("get_notes", { bookId: "00000000-0000-4000-8000-000000000000" });
    expect(missing).toMatchObject({ error: true, text: "Book not found." });
    const badSection = await call("add_note", { bookId: jekyll, text: "x", sectionId: "nope" });
    expect(badSection.error).toBe(true);
    expect(badSection.text).toContain("Use a sectionId from a search result");
    // The schema refuses an empty note before the tool runs.
    expect((await call("add_note", { bookId: jekyll, text: "" })).error).toBe(true);
  });
});

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Db } from "@/lib/db/client";
import { AgentError, agentAddNote, agentBooks, agentNotes, agentSearch } from "./library";

/**
 * The MCP server (M11): MCP, the Model Context Protocol, is the standard way
 * AI agents such as Claude plug into a tool. These four tools wrap the same
 * functions as the HTTP agent API (lib/agent/library.ts), for one reader (the
 * API token's user); notes added here carry the token's name.
 */
export function buildMcpServer(db: Db, userId: string, agent: string) {
  const server = new McpServer({ name: "neolibrary", version: "1.0.0" });

  /** Runs a tool: its answer as JSON text, or a readable error the model can act on. */
  const run = async (work: () => Promise<unknown>) => {
    try {
      return { content: [{ type: "text" as const, text: JSON.stringify(await work(), null, 2) }] };
    } catch (e) {
      if (e instanceof AgentError) return { content: [{ type: "text" as const, text: e.message }], isError: true };
      throw e;
    }
  };

  server.registerTool(
    "list_books",
    {
      title: "List books",
      description: "Lists the books in the reader's Neolibrary (title, author, id, reading progress 0 to 1). Optionally filter by title or author.",
      inputSchema: { query: z.string().max(100).optional().describe("Words from a title or author, e.g. 'wells'") },
      annotations: { readOnlyHint: true },
    },
    ({ query }) => run(async () => ({ books: await agentBooks(db, userId, query) })),
  );

  server.registerTool(
    "search_text",
    {
      title: "Search the books' text",
      description:
        "Full-text search across the reader's books. Returns matching paragraphs with the matched words in **double asterisks**, the book and chapter, and a sectionId that add_note can attach a note to. Supports quoted phrases.",
      inputSchema: {
        query: z.string().min(1).max(200).describe("What to search for, e.g. 'Utterson the lawyer' or a \"quoted phrase\""),
        limit: z.number().int().min(1).max(50).optional().describe("How many results (default 20)"),
      },
      annotations: { readOnlyHint: true },
    },
    ({ query, limit }) => run(async () => ({ results: await agentSearch(db, userId, query, limit ?? 20) })),
  );

  server.registerTool(
    "get_notes",
    {
      title: "Read highlights and notes",
      description:
        "The reader's current highlights, bookmarks and notes on one book, in reading order. Notes an agent added have addedByAgent set.",
      inputSchema: { bookId: z.string().describe("The book's id, from list_books or search_text") },
      annotations: { readOnlyHint: true },
    },
    ({ bookId }) => run(async () => ({ notes: await agentNotes(db, userId, bookId) })),
  );

  server.registerTool(
    "add_note",
    {
      title: "Add a note",
      description:
        "Adds a note to a book in the reader's library, marked as written by this agent. With a sectionId from search_text, the note is attached to (and highlights) that paragraph; without one, it is a note on the whole book.",
      inputSchema: {
        bookId: z.string().describe("The book's id"),
        text: z.string().min(1).max(10_000).describe("The note"),
        sectionId: z.string().optional().describe("A paragraph's sectionId from search_text"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    ({ bookId, text, sectionId }) => run(async () => ({ note: await agentAddNote(db, userId, agent, { bookId, text, sectionId }) })),
  );

  return server;
}

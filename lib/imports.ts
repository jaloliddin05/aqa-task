import { visit, type ParseErrorCode, printParseErrorCode } from "jsonc-parser";
import { z } from "zod";

const line = (max: number) => z.string().trim().min(1).max(max);
export const topicSchema = z.strictObject({
  schemaVersion: z.literal(1),
  type: z.literal("topic"),
  title: line(120),
  content: line(30000),
  reviewSummary: line(2000),
  recallPrompt: line(300),
});
const questionSchema = z.strictObject({
  prompt: line(500),
  options: z.array(line(250)).length(4).refine(
    (options) => new Set(options.map((option) => option.toLowerCase())).size === options.length,
    "Options must be distinct",
  ),
  correctOptionIndex: z.number().int().min(0).max(3),
  explanation: line(1000),
});
export const quizSchema = z.strictObject({
  schemaVersion: z.literal(1),
  type: z.literal("quiz"),
  title: line(120),
  questions: z.array(questionSchema).min(1).max(30),
});
export type Question = z.infer<typeof questionSchema>;
export const maxImportBytes = 512 * 1024;

export function parseImport(raw: string, kind: "topic"): z.infer<typeof topicSchema>;
export function parseImport(raw: string, kind: "quiz"): z.infer<typeof quizSchema>;
export function parseImport(raw: string, kind: "topic" | "quiz") {
  if (new TextEncoder().encode(raw).length > maxImportBytes) throw new Error("The file exceeds 512 KiB.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Expected a raw JSON object. Remove Markdown fences and check quotes, commas, and brackets.");
  }
  const objects: Set<string>[] = [];
  visit(raw, {
    onObjectBegin: () => { objects.push(new Set()); },
    onObjectEnd: () => { objects.pop(); },
    onObjectProperty: (name, _offset, _length, row, column) => {
      const keys = objects.at(-1)!;
      if (keys.has(name)) throw new Error(`Duplicate key "${name}" at line ${row + 1}, column ${column + 1}.`);
      keys.add(name);
    },
    onError: (code: ParseErrorCode) => { throw new Error(printParseErrorCode(code)); },
  });
  const result = (kind === "topic" ? topicSchema : quizSchema).safeParse(parsed);
  if (!result.success) throw new Error(result.error.issues.map(({ path, message }) =>
    `${path.map((part, index) => typeof part === "number" ? `[${part}]` : `${index ? "." : ""}${String(part)}`).join("") || "File"}: ${message}`,
  ).join("\n"));
  return result.data;
}

const intro = "Use the topic or material I provide. Preserve its language unless I specify another. Return one valid UTF-8 JSON object only. Omit Markdown fences, comments, and surrounding text. Escape newlines and quotes inside JSON strings. Use exactly the listed keys.";
export const prompts = {
  topic: `Create a QA study topic. ${intro} Use schemaVersion (integer 1), type (string "topic"), title (1–120 characters), content (Markdown, 1–30,000 characters, with QA examples), reviewSummary (Markdown, 1–2,000 characters), and recallPrompt (plain text, 1–300 characters, asking the reader to recall the key points before seeing the summary).`,
  quiz: `Create a single-choice QA quiz. ${intro} Use schemaVersion (integer 1), type (string "quiz"), title (1–120 characters), and questions (an array of 1–30 objects, default 10). Each question uses exactly prompt (plain text, 1–500 characters), options (exactly four distinct plain-text strings, each 1–250 characters), correctOptionIndex (integer 0–3, where 0 is the first option), and explanation (plain text, 1–1,000 characters). Include exactly one correct answer per question. Verify that the index and explanation agree. Use QA scenarios where appropriate.`,
};
export const examples = {
  topic: { schemaVersion: 1, type: "topic", title: "Boundary value analysis", content: "For a field accepting 1–50 characters, test **0, 1, 2, 49, 50, 51**.", reviewSummary: "Check the boundary and its immediate neighbors.", recallPrompt: "Which lengths would you test for a field accepting 1–50 characters?" },
  quiz: { schemaVersion: 1, type: "quiz", title: "Boundary value practice", questions: [{ prompt: "What is the first invalid length above a maximum of 50?", options: ["49", "50", "51", "52"], correctOptionIndex: 2, explanation: "51 is immediately outside the upper boundary." }] },
};

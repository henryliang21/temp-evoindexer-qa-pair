import mammoth from "mammoth";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_CHARS = 200_000;

/** An input problem whose message can be shown to the user as-is. */
export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

export function fileKind(filename: string): "docx" | "txt" {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".txt")) return "txt";
  throw new InputError("Only .docx and .txt files are supported");
}

/** UTF-8 first; Chinese text files are often GBK, which GB18030 decodes. */
export function decodeText(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("gb18030").decode(bytes);
  }
  return text.replace(/^\uFEFF/, "");
}

export async function extractText(filename: string, bytes: Uint8Array): Promise<string> {
  let text: string;
  if (fileKind(filename) === "docx") {
    try {
      text = (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;
    } catch {
      throw new InputError("Could not read the .docx file. Is it a valid Word document?");
    }
  } else {
    text = decodeText(bytes);
  }

  text = text.replace(/\r\n?/g, "\n").trim();
  if (!text) throw new InputError("The document contains no text");

  const chars = [...text].length;
  if (chars > MAX_TEXT_CHARS) {
    throw new InputError(
      `The document has ${chars.toLocaleString("en-US")} characters of text; the limit is ${MAX_TEXT_CHARS.toLocaleString("en-US")}`,
    );
  }
  return text;
}

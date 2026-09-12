export interface Prompt {
  system: string;
  user: string;
}

export function extractPrompt({ context, chunk, maxChars }: { context: string; chunk: string; maxChars: number }): Prompt {
  const system = [
    "You turn source documents into a knowledge base for a digital human that answers visitors' questions by speaking.",
    "From the document section you are given, extract every fact a visitor might ask about, as a list of units. Each unit has an answer and its evidence.",
    "",
    "Rules for each answer:",
    "- Use only what the section states. Do not add outside knowledge, guesses, or conclusions the text does not state.",
    "- Make it self-contained: it will be heard without the document, so name the subject explicitly instead of using words like 我们, 这里, 这个展厅, or 它.",
    `- Keep it short enough to speak: at most ${maxChars} characters. If a fact needs more, split it into several units that each stand alone.`,
    "- Write natural, complete spoken sentences. No lists, bullet points, markdown, bracketed notes, or URLs.",
    "- Write numbers, dates, and quantities exactly as the source writes them. Do not convert between Chinese and Arabic numerals.",
    "- Write in the same language as the document.",
    "",
    "Rules for evidence:",
    "- Give 1 to 3 quotes copied verbatim from the section. Each quote is a contiguous span of the original text. Together they support everything the answer says.",
    "",
    "Skip text that is only an instruction to the presenter or a stage direction (for example, a note to introduce something based on the wall content).",
    "Cover the whole section, not just its beginning.",
  ].join("\n");
  return { system, user: `Document: ${context}\n\n<section>\n${chunk}\n</section>` };
}

export function repairPrompt({
  context,
  units,
  maxChars,
}: {
  context: string;
  units: { answer: string; evidence: string[] }[];
  maxChars: number;
}): Prompt {
  const system = [
    "You rewrite answers that a digital human speaks aloud.",
    `Each answer below is longer than ${maxChars} characters. Rewrite each one into one or more units whose answers are at most ${maxChars} characters.`,
    "Use only the information in that answer's evidence. Keep every answer self-contained, in natural spoken sentences, in the same language.",
    "Write numbers exactly as the evidence writes them.",
    "For each new unit, give 1 to 3 quotes copied verbatim from the given evidence as its evidence.",
  ].join("\n");
  return { system, user: `Document: ${context}\n\n${JSON.stringify(units, null, 2)}` };
}

export function questionsPrompt({
  context,
  units,
  variants,
}: {
  context: string;
  units: { id: string; answer: string }[];
  variants: number;
}): Prompt {
  const system = [
    "You write the questions visitors would ask a digital human, for a question-matching knowledge base.",
    `For each answer below, write ${variants} different questions that this answer fully answers.`,
    "",
    "Rules:",
    "- Vary the angle and wording, not just synonyms. Mix styles such as a direct question, a casual spoken question a visitor would ask, a short keyword-style query, and why / how / when / who / how-many questions where the answer supports them.",
    "- Every question must be fully answered by its answer. Do not ask about anything the answer does not contain.",
    "- Each question must name its subject so it makes sense on its own; never rely on 它 or other context.",
    "- Write in the same language as the answers.",
    "- Return one item per answer, using the answer's id.",
  ].join("\n");
  return { system, user: `Document: ${context}\n\n${JSON.stringify(units, null, 2)}` };
}

// Colours and a frame for what a person reads in a terminal. styleText drops
// the colours when stdout is not a TTY or NO_COLOR is set, so an agent that
// runs the same command through a pipe reads plain text.
import { stripVTControlCharacters, styleText } from "node:util";

type Format = Parameters<typeof styleText>[0];

export const paint = (format: Format, text: string): string => styleText(format, text);

const STATUS: Record<string, Format> = { OK: "green", INFO: "dim", SKIP: "dim", WARN: "yellow", FAIL: ["bold", "red"] };

export const status = (s: string): string => paint(STATUS[s] ?? "reset", s.padEnd(4));

const visible = (s: string) => stripVTControlCharacters(s).length;

// Plain lines when piped, or when the terminal is too narrow and the frame
// would wrap into pieces.
export function box(lines: string[]): string {
  const width = Math.max(...lines.map(visible));

  if (!process.stdout.isTTY || width + 6 > (process.stdout.columns ?? 0)) return lines.join("\n");

  const edge = (left: string, right: string) => paint("dim", `${left}${"─".repeat(width + 4)}${right}`);
  const row = (line: string) => `${paint("dim", "│")}  ${line}${" ".repeat(width - visible(line))}  ${paint("dim", "│")}`;

  return [edge("╭", "╮"), ...lines.map(row), edge("╰", "╯")].join("\n");
}

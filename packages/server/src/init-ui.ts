import { intro, log, note, outro, spinner } from "@clack/prompts";
import { homedir } from "node:os";
import type { ClientReport } from "./clients.js";

const tildify = (text: string) => text.replace(homedir(), "~");

/** Styled with clack in a terminal; plain lines when piped or in CI. */
export function createUi(interactive: boolean) {
  const plain = (message: string) => console.log(message);
  return {
    intro: (title: string) => (interactive ? intro(title) : undefined),
    outro: (message: string) => (interactive ? outro(message) : undefined),
    info: (message: string) => (interactive ? log.info(message) : plain(message)),
    success: (message: string) => (interactive ? log.success(message) : plain(message)),
    warn: (message: string) => (interactive ? log.warn(message) : plain(message)),
    note: (title: string, lines: string[]) =>
      interactive
        ? note(lines.join("\n"), title)
        : plain(`${title}:\n${lines.map((l) => `  ${l}`).join("\n")}`),
    client(report: ClientReport) {
      if (!interactive) {
        plain(`${report.status.padEnd(8)} ${report.client.padEnd(15)} ${report.detail}`);
      } else if (report.status === "written") {
        log.success(`${report.client}: ${tildify(report.detail)}`);
      } else if (report.status === "failed") {
        log.error(`${report.client}: ${tildify(report.detail)}`);
      } else {
        log.message(`${report.client}: ${tildify(report.detail)}`);
      }
    },
    async task<T>(label: string, done: string, work: () => Promise<T>): Promise<T> {
      if (!interactive) return work();
      const spin = spinner();
      spin.start(label);
      try {
        const result = await work();
        spin.stop(done);
        return result;
      } catch (error) {
        spin.error(`${label} failed`);
        throw error;
      }
    },
  };
}

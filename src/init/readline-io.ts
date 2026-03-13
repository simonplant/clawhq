/**
 * Readline-based WizardIO implementation for terminal interaction.
 */

import { createInterface, type Interface } from "node:readline";

import type { WizardIO } from "./types.js";

export function createReadlineIO(): { io: WizardIO; close: () => void } {
  const rl: Interface = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (q: string): Promise<string> =>
    new Promise((resolve) => {
      rl.question(q, (answer) => resolve(answer));
    });

  const io: WizardIO = {
    async prompt(text: string, defaultValue?: string): Promise<string> {
      const suffix = defaultValue ? ` [${defaultValue}]` : "";
      const answer = await question(`${text}${suffix}: `);
      return answer.trim() || defaultValue || "";
    },

    async select(text: string, choices: string[]): Promise<number> {
      console.log(text + ":");
      for (let i = 0; i < choices.length; i++) {
        console.log(`  ${i + 1}. ${choices[i]}`);
      }
      while (true) {
        const answer = await question(`Enter number (1-${choices.length}): `);
        const num = parseInt(answer.trim(), 10);
        if (num >= 1 && num <= choices.length) {
          return num - 1;
        }
        console.log(`Please enter a number between 1 and ${choices.length}.`);
      }
    },

    async confirm(text: string, defaultValue = true): Promise<boolean> {
      const suffix = defaultValue ? " [Y/n]" : " [y/N]";
      const answer = await question(`${text}${suffix}: `);
      const trimmed = answer.trim().toLowerCase();
      if (trimmed === "") return defaultValue;
      return trimmed === "y" || trimmed === "yes";
    },

    log(message: string): void {
      console.log(message);
    },
  };

  return { io, close: () => rl.close() };
}

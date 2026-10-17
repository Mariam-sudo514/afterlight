import { createInterface, emitKeypressEvents } from "node:readline";
import { stdin, stdout } from "node:process";

export class TerminalInputError extends Error {}

export function assertInteractiveTerminal() {
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== "function") {
    throw new TerminalInputError(
      "Запустите команду в обычном интерактивном терминале. Ввод секретов через pipe или файл запрещён.",
    );
  }
}

/** Nonsecret input only. The terminal displays the answer. */
export function ask(question) {
  assertInteractiveTerminal();
  const prompt = createInterface({
    input: stdin,
    output: stdout,
    terminal: true,
  });
  return new Promise((resolve, reject) => {
    let answered = false;
    prompt.once("close", () => {
      if (!answered) reject(new TerminalInputError("Отменено."));
    });
    prompt.once("SIGINT", () => prompt.close());
    prompt.question(question, (answer) => {
      answered = true;
      prompt.close();
      resolve(answer.trim());
    });
  });
}

/** No-echo secret input; every completion/abort restores the terminal's mode. */
export function secret(question) {
  assertInteractiveTerminal();
  return new Promise((resolve, reject) => {
    let value = "";
    let finished = false;
    const previousRaw = Boolean(stdin.isRaw);
    const finish = (error) => {
      if (finished) return;
      finished = true;
      stdin.removeListener("keypress", onKey);
      process.removeListener("SIGINT", interrupted);
      process.removeListener("SIGTERM", interrupted);
      process.removeListener("SIGHUP", interrupted);
      stdin.setRawMode(previousRaw);
      stdin.pause();
      stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
      value = "";
    };
    const interrupted = () => finish(new TerminalInputError("Отменено."));
    const onKey = (text, key = {}) => {
      if (key.ctrl && ["c", "d"].includes(key.name)) return interrupted();
      if (key.name === "return" || key.name === "enter") return finish();
      if (key.name === "backspace") {
        value = [...value].slice(0, -1).join("");
        return;
      }
      if (key.ctrl && key.name === "u") {
        value = "";
        return;
      }
      if (key.ctrl || key.meta || !text || /[\x00-\x1f\x7f]/.test(text)) return;
      value += text;
      if (value.length > 1024)
        finish(new TerminalInputError("Введённое значение слишком длинное."));
    };
    emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("keypress", onKey);
    process.once("SIGINT", interrupted);
    process.once("SIGTERM", interrupted);
    process.once("SIGHUP", interrupted);
    stdout.write(question);
  });
}

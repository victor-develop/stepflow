import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

export async function gitStatus(cwd: string): Promise<string> {
  return git(cwd, "status", "--porcelain");
}

export async function gitBranches(
  cwd: string
): Promise<{ current: string; branches: string[] }> {
  const output = await git(cwd, "branch", "--no-color");
  const lines = output.split("\n").filter(Boolean);
  let current = "";
  const branches: string[] = [];

  for (const line of lines) {
    const name = line.replace(/^\*?\s+/, "");
    branches.push(name);
    if (line.startsWith("*")) {
      current = name;
    }
  }

  return { current, branches };
}

export async function gitCommit(
  cwd: string,
  message: string,
  files?: string[]
): Promise<string> {
  if (files && files.length > 0) {
    await git(cwd, "add", ...files);
  } else {
    await git(cwd, "add", "-A");
  }
  return git(cwd, "commit", "-m", message);
}

export async function gitCheckout(
  cwd: string,
  branch: string,
  create: boolean = false
): Promise<string> {
  if (create) {
    return git(cwd, "checkout", "-b", branch);
  }
  return git(cwd, "checkout", branch);
}

export async function gitDiff(cwd: string): Promise<string> {
  return git(cwd, "diff");
}

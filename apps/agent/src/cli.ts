#!/usr/bin/env node

const VERSION = "0.1.0";

function main(argv: string[]): void {
  const cmd = argv[2];
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  console.log("synchub-agent — commands land in Phase 4. Try --version.");
}

main(process.argv);

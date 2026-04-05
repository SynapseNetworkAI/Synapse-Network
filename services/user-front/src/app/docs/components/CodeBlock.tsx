"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

// ─── Colour palettes ──────────────────────────────────────────────────────────

const C = {
  keyword:  "#7ff7be",  // from / import / for / if / try / except / as / def / class / return / and / in / not / or / with / yield / lambda / pass / break / continue / raise / del / global / nonlocal / assert / async / await
  builtin:  "#e7e9ea",  // print, len, range… and plain identifiers
  string:   "#f4a261",  // "…" / '…' / """…"""
  comment:  "#636870",  // # comment
  number:   "#6ab0f5",  // 123, 1.5, 0x…
  operator: "#9aa4af",  // = ( ) . , : { } [ ] + - * / % < > ! & | ^ ~
  bash_cmd: "#7ff7be",  // first token on bash line
  bash_flag:"#6eb6f6",  // --flag / -f
  bash_str: "#f4a261",  // "quoted" in bash
  dim:      "#4e535a",  // \ continuation, #! shebang
  plain:    "#c0c5cc",  // default
} as const;

// ─── Tokenisers ───────────────────────────────────────────────────────────────

type Token = { text: string; col: string };

const PY_KEYWORDS = new Set([
  "from","import","as","def","class","return","if","elif","else","for","while",
  "in","not","and","or","is","try","except","finally","raise","with","yield",
  "lambda","pass","break","continue","del","global","nonlocal","assert","async",
  "await","True","False","None",
]);

function tokenisePython(code: string): Token[] {
  const tokens: Token[] = [];
  // Match: triple-quoted string | single-quoted string | comment | number | ident | operator/whitespace
  const re = /("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(#[^\n]*)|(\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|([A-Za-z_]\w*)|([\s\S])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    if (m[1]) { tokens.push({ text: m[1], col: C.string }); }
    else if (m[2]) { tokens.push({ text: m[2], col: C.comment }); }
    else if (m[3]) { tokens.push({ text: m[3], col: C.number }); }
    else if (m[4]) { tokens.push({ text: m[4], col: PY_KEYWORDS.has(m[4]) ? C.keyword : C.plain }); }
    else { tokens.push({ text: m[5]!, col: C.operator }); }
  }
  return tokens;
}

function tokeniseBash(code: string): Token[] {
  const tokens: Token[] = [];
  const lines = code.split("\n");
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (li > 0) tokens.push({ text: "\n", col: C.plain });
    if (line.startsWith("#!")) { tokens.push({ text: line, col: C.dim }); continue; }
    if (line.trimStart().startsWith("#")) { tokens.push({ text: line, col: C.comment }); continue; }

    // Tokenise: first command word, then flags, quoted strings, backslash-cont, rest
    const re = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(--?[\w-]+)|(\\\s*$)|([\w./:-]+)|([\s\S])/g;
    let firstWord = true;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      if (m[1]) { tokens.push({ text: m[1], col: C.bash_str }); }
      else if (m[2]) { tokens.push({ text: m[2], col: C.bash_flag }); }
      else if (m[3]) { tokens.push({ text: m[3], col: C.dim }); }
      else if (m[4]) {
        if (firstWord) {
          tokens.push({ text: m[4], col: C.bash_cmd });
          firstWord = false;
        } else {
          tokens.push({ text: m[4], col: C.plain });
        }
      } else {
        // whitespace / punctuation
        tokens.push({ text: m[5]!, col: C.operator });
        // after real whitespace, next bare word is still an arg, not a command
      }
    }
  }
  return tokens;
}

function tokeniseTs(code: string): Token[] {
  // Reuse Python tokeniser with TS keyword set
  const TS_KEYWORDS = new Set([
    "import","export","from","const","let","var","function","return","class",
    "new","if","else","for","while","try","catch","finally","throw","async",
    "await","typeof","instanceof","this","true","false","null","undefined",
    "type","interface","extends","implements","void","break","continue","in",
    "of","switch","case","default","delete","yield","static","public","private",
    "protected","readonly","enum","namespace","as","is","keyof","satisfies",
  ]);
  const tokens: Token[] = [];
  const re = /(`[\s\S]*?`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\/\/[^\n]*)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|([\s\S])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    if (m[1]) { tokens.push({ text: m[1], col: C.string }); }
    else if (m[2]) { tokens.push({ text: m[2], col: C.comment }); }
    else if (m[3]) { tokens.push({ text: m[3], col: C.number }); }
    else if (m[4]) { tokens.push({ text: m[4], col: TS_KEYWORDS.has(m[4]) ? C.keyword : C.plain }); }
    else { tokens.push({ text: m[5]!, col: C.operator }); }
  }
  return tokens;
}

function tokenise(code: string, lang: string): Token[] | null {
  if (lang === "python" || lang === "py") return tokenisePython(code);
  if (lang === "bash" || lang === "shell" || lang === "sh") return tokeniseBash(code);
  if (lang === "typescript" || lang === "ts" || lang === "javascript" || lang === "js") return tokeniseTs(code);
  return null; // plain
}

// ─── Components ──────────────────────────────────────────────────────────────

export function CopyButton({ text }: Readonly<{ text: string }>) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
      className="p-1.5 rounded-md text-[#71767b] hover:text-white hover:bg-white/[0.08] transition-colors"
      aria-label="Copy code"
    >
      {copied ? <Check size={13} className="text-[#7ff7be]" /> : <Copy size={13} />}
    </button>
  );
}

export function CodeBlock({
  code,
  lang = "bash",
}: Readonly<{ code: string; lang?: string }>) {
  const trimmed = code.trim();
  const tokens = tokenise(trimmed, lang);

  return (
    <div className="relative mt-4 rounded-xl overflow-hidden border border-white/[0.06] bg-[#0a0b0d]">
      {/* header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.05]">
        <span className="text-[10px] font-semibold tracking-widest uppercase font-mono" style={{ color: C.dim }}>
          {lang}
        </span>
        <CopyButton text={trimmed} />
      </div>
      {/* code body */}
      <pre className="p-4 text-[13px] font-mono leading-relaxed overflow-x-auto whitespace-pre">
        {tokens
          ? tokens.map((t, i) => (
              <span key={i} style={{ color: t.col }}>{t.text}</span>
            ))
          : <span style={{ color: C.plain }}>{trimmed}</span>
        }
      </pre>
    </div>
  );
}


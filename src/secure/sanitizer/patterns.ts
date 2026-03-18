/**
 * Detection patterns for prompt injection, delimiter spoofing, data exfiltration,
 * and obfuscation attacks. Organized by OWASP LLM01 detectability tier.
 *
 * Tier 1: High detectability — direct injection keywords, fake delimiters, invisible chars.
 * Tier 2: Medium detectability — homoglyphs, multilingual injection, few-shot spoofing.
 */

// ── Tier 1: High Detectability ──────────────────────────────────────────────

/** Unicode ranges used to hide content from human review. */
export const INVISIBLE_RANGES = new RegExp(
  "[" +
    "\u200b-\u200f" +
    "\u2028-\u202f" +
    "\u2060-\u2064" +
    "\u2066-\u2069" +
    "\ufeff" +
    "\ufff9-\ufffb" +
    "\u{e0000}-\u{e007f}" +
    "\u{fe00}-\u{fe0f}" +
    "]+",
  "gu",
);

/** Direct prompt override / role hijack attempts. */
export const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above|earlier|preceding)\s+(instructions?|prompts?|rules?|guidelines?|context)/i,
  /disregard\s+(all\s+)?(previous|prior|above|earlier)/i,
  /forget\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|context|rules?)/i,
  /override\s+(all\s+)?(previous|prior|safety|security)\s+(instructions?|rules?|guidelines?)/i,
  /you\s+are\s+now\s+(a|an)\s+/i,
  /you\s+are\s+no\s+longer\s+/i,
  /new\s+(role|persona|instructions?|identity|mode)\s*:/i,
  /(system|developer|debug|god|admin|root|sudo|maintenance)\s*mode/i,
  /do\s+not\s+follow\s+(previous|prior|your|the)\s+(instructions?|rules?|guidelines?)/i,
  /IMPORTANT\s*:\s*(override|update|change|new\s+instructions?)/i,
  /(execute|run)\s+(the\s+following|this)\s+(command|code|script|instruction)/i,
  /run\s+the\s+following\s+command/i,
  /act\s+as\s+(if\s+)?(you\s+(are|were)|an?\s+)/i,
  /pretend\s+(to\s+be|you\s+are|that)/i,
  /jailbreak/i,
  /\bDAN\b(?:\s+mode)?/i,
  /bypass\s+(all\s+)?(safety|security|content|filter|restriction|guardrail)/i,
  /remove\s+(all\s+)?(restriction|filter|safety|guardrail|limitation)s?/i,
  /without\s+(any\s+)?(restriction|filter|safety|guardrail|limitation|censorship)s?/i,
];

/** Fake LLM protocol delimiters injected into user content. */
export const DELIMITER_PATTERNS: RegExp[] = [
  /<\|im_(start|end)\|>/,
  /\[INST\]|\[\/INST\]/,
  /<<SYS>>|<<\/SYS>>/,
  /<\|endoftext\|>/,
  /<\|system\|>|<\|user\|>|<\|assistant\|>/,
  /<\/?system>|<\/?user>|<\/?assistant>/i,
  /###\s*(System|Human|Assistant|User)\s*:/i,
  /\[SYSTEM\]|\[\/SYSTEM\]|\[USER\]|\[\/USER\]/,
  /<\|begin_of_text\|>|<\|end_of_text\|>/,
  /<\|start_header_id\|>|<\|end_header_id\|>/,
  /\bEND\s+OF\s+(SYSTEM\s+)?(PROMPT|INSTRUCTIONS?|CONTEXT)\b/i,
  /\bBEGIN\s+NEW\s+(INSTRUCTIONS?|PROMPT|CONTEXT)\b/i,
];

/** Encoded payloads that may hide instructions. */
export const ENCODING_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /[A-Za-z0-9+/]{20,}={0,2}/, type: "base64_blob" },
  { pattern: /(?:0x)?[0-9a-fA-F]{24,}/, type: "hex_blob" },
  { pattern: /(?:%[0-9a-fA-F]{2}){6,}/, type: "url_encoded_blob" },
];

/** Instructions to decode obfuscated content. */
export const DECODE_KEYWORDS =
  /(decode|decrypt|deobfuscate|translate|convert|interpret|execute)\s+(the\s+)?(following\s+)?(base64|hex|rot13|morse|binary|encoded|cipher|code)/i;

/** Markup that exfiltrates data via embedded URLs. */
export const EXFIL_PATTERNS: RegExp[] = [
  /!\[.*?\]\(https?:\/\/[^)]+\)/,
  /<img[^>]+src\s*=\s*["']https?:\/\//i,
  /<iframe[^>]+src\s*=/i,
  /<script[\s>]/i,
  /<link[^>]+href\s*=\s*["']https?:\/\//i,
];

// ── Tier 2: Medium Detectability ────────────────────────────────────────────

/**
 * Homoglyph map: visually identical chars from Cyrillic, Greek, and fullwidth
 * ranges that can disguise injection keywords from pattern matching.
 */
export const CONFUSABLE_MAP: ReadonlyMap<string, string> = new Map([
  // Cyrillic
  ["\u0430", "a"], ["\u0441", "c"], ["\u0435", "e"], ["\u0456", "i"],
  ["\u043e", "o"], ["\u0440", "p"], ["\u0443", "y"], ["\u0445", "x"],
  ["\u0410", "A"], ["\u0421", "C"], ["\u0415", "E"], ["\u041e", "O"],
  ["\u0420", "P"], ["\u0423", "Y"], ["\u0425", "X"],
  // Greek
  ["\u03bf", "o"], ["\u03b1", "a"], ["\u03b5", "e"],
  ["\u039f", "O"], ["\u0391", "A"], ["\u0395", "E"],
  // Fullwidth Latin
  ["\uff41", "a"], ["\uff42", "b"], ["\uff43", "c"], ["\uff44", "d"],
  ["\uff45", "e"], ["\uff46", "f"], ["\uff47", "g"], ["\uff48", "h"],
  ["\uff49", "i"], ["\uff4a", "j"], ["\uff4b", "k"], ["\uff4c", "l"],
  ["\uff4d", "m"], ["\uff4e", "n"], ["\uff4f", "o"], ["\uff50", "p"],
]);

/** Morse-encoded content (potential obfuscated instructions). */
export const MORSE_PATTERN = /^[.\-\s/]{20,}$/;

/** Fake conversation turns injected to steer few-shot behavior. */
export const FEWSHOT_PATTERNS = {
  user: /(^|\n)\s*(User|Human|Customer|Person|Q)\s*:/i,
  assistant: /(^|\n)\s*(Assistant|AI|Agent|Bot|A)\s*:/i,
} as const;

/** Prompt injection in non-English languages (8 language families). */
export const MULTILINGUAL_INJECTION: RegExp[] = [
  /ignorez?\s+(toutes?\s+)?(les\s+)?instructions?\s+pr[ée]c[ée]dentes?/i,
  /ignorar?\s+(todas?\s+)?(las\s+)?instrucciones?\s+anteriores?/i,
  /ignor(ieren?|iere)\s+(Sie\s+)?(alle\s+)?vorherigen?\s+(Anweisungen?|Instruktionen?)/i,
  /前の指示を(すべて)?無視/i,
  /忽略(所有)?之前的指[令示]/i,
  /이전\s*(모든\s*)?지시를?\s*무시/i,
  /игнорируй(те)?\s+(все\s+)?предыдущие\s+инструкции/i,
  /تجاهل\s+(جميع\s+)?التعليمات\s+السابقة/i,
];

/** Natural-language instructions to exfiltrate data. */
export const EXFIL_INSTRUCTIONS: RegExp[] = [
  /(send|forward|post|upload|transmit|exfiltrate|leak)\s+(to|at|via)\s+\S+/i,
  /(include|embed|append|attach)\s+.{0,30}(in\s+the\s+)?(url|link|image|request|query)/i,
  /(api|secret|token|key|password|credential|session|cookie)\s*.{0,10}\s*(to|at|via)\s+/i,
];

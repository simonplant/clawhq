/**
 * Detection patterns for prompt injection, delimiter spoofing, data exfiltration,
 * and obfuscation attacks. Organized by OWASP LLM01 detectability tier.
 *
 * Tier 1: High detectability — direct injection keywords, fake delimiters, invisible chars.
 * Tier 2: Medium detectability — homoglyphs, multilingual injection, few-shot spoofing.
 */

// ── Tier 1: High Detectability ──────────────────────────────────────────────

/* eslint-disable no-misleading-character-class -- intentionally matching ZWNJ/ZWJ (U+200C/D) */
/** Unicode ranges used to hide content from human review. */
export const INVISIBLE_RANGES = new RegExp(
  "[" +
    "\\u200b-\\u200f" +
    "\\u2028-\\u202f" +
    "\\u2060-\\u2064" +
    "\\u2066-\\u2069" +
    "\\ufeff" +
    "\\ufff9-\\ufffb" +
    "\\u{e0000}-\\u{e007f}" +
    "\\u{fe00}-\\u{fe0f}" +
    "]+",
  "gu",
);
/* eslint-enable no-misleading-character-class */

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
  user: /(^|\n)\s*(User|Human|Customer|Person)\s*:/i,
  assistant: /(^|\n)\s*(Assistant|AI|Agent|Bot)\s*:/i,
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

// ── Tier 1: Secret Leak Detection ──────────────────────────────────────────

/** Common secret/credential formats that should never appear in LLM context. */
export const SECRET_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /AKIA[0-9A-Z]{16}/, type: "aws_access_key" },
  { pattern: /(?:aws_secret_access_key|AWS_SECRET)\s*[:=]\s*[A-Za-z0-9/+=]{40}/, type: "aws_secret" },
  { pattern: /ghp_[A-Za-z0-9_]{36,}/, type: "github_pat" },
  { pattern: /ghs_[A-Za-z0-9_]{36,}/, type: "github_server_token" },
  { pattern: /xox[baprs]-[A-Za-z0-9\-]{10,}/, type: "slack_token" },
  { pattern: /sk-[A-Za-z0-9]{20,}/, type: "openai_api_key" },
  { pattern: /-----BEGIN\s+(?:RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE\s+KEY-----/, type: "private_key" },
  { pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/, type: "jwt_token" },
  { pattern: /Bearer\s+[A-Za-z0-9\-._~+/]{20,}=*/, type: "bearer_token" },
  { pattern: /(?:api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token)\s*[:=]\s*['"]?[A-Za-z0-9\-._~+/]{16,}['"]?/i, type: "generic_api_key" },
  { pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"]?[^\s'"]{8,}['"]?/i, type: "password_assignment" },
];

// ── Tier 2: Indirect Elicitation ───────────────────────────────────────────

/** Social engineering attempts to extract secrets or system prompts. */
export const ELICITATION_PATTERNS: RegExp[] = [
  /(?:what\s+is|show|tell|give|reveal|display|print|output|dump|list)\s+(?:me\s+)?(?:your|the)\s+(?:api[_\s-]?key|password|secret|token|credentials?|\.env|system\s+prompt|instructions?|config(?:uration)?)/i,
  /(?:show|tell|give|reveal|display)\s+(?:me\s+)?(?:all\s+)?(?:your|the)\s+(?:secrets?|keys?|tokens?|passwords?|credentials?)/i,
  /(?:read|cat|type|head|tail|more|less)\s+(?:\/etc\/(?:shadow|passwd)|\.env|credentials?\.json|\.(?:bash|zsh)_history)/i,
  /(?:repeat|recite|echo|reproduce)\s+(?:your\s+)?(?:system\s+(?:prompt|message|instructions?)|initial\s+(?:prompt|instructions?))/i,
  /(?:what|how)\s+(?:are|were)\s+you\s+(?:instructed|programmed|configured|prompted|told)\s+to/i,
  /(?:above|preceding)\s+(?:text|content|prompt|instructions?)\s+(?:verbatim|exactly|word.for.word)/i,
];

// ── Tier 2: Semantic Override ──────────────────────────────────────────────

/** Instruction hijacking via meaning rather than explicit override keywords. */
export const SEMANTIC_OVERRIDE_PATTERNS: RegExp[] = [
  /from\s+now\s+on\s+(?:you\s+)?(?:will|must|should|shall|are\s+going\s+to|need\s+to)/i,
  /your\s+(?:new|updated|revised|actual|real|true)\s+(?:task|objective|goal|mission|purpose|instructions?|role)\s+(?:is|are)\b/i,
  /(?:for|during)\s+the\s+rest\s+of\s+this\s+(?:conversation|session|chat|interaction)/i,
  /starting\s+(?:now|immediately|from\s+this\s+point)\s*,?\s*(?:you|your)/i,
  /(?:the\s+)?(?:above|previous|prior)\s+(?:instructions?|rules?|prompt)\s+(?:(?:is|are)\s+)?(?:wrong|fake|outdated|invalid|superseded|overridden)/i,
  /here\s+(?:are|is)\s+your\s+(?:actual|real|true|correct|updated|new)\s+(?:instructions?|prompt|rules?|guidelines?)/i,
  /(?:I\s+am|this\s+is)\s+(?:the|your|an?)\s+(?:administrator|developer|creator|owner|operator|maintainer)/i,
  /(?:I\s+have|with)\s+(?:admin|administrator|root|sudo|elevated)\s+(?:access|privileges?|permissions?|rights?)/i,
  /(?:security|admin|override|authorization)\s+(?:code|token)\s*[:=]/i,
  /(?:this\s+is\s+)?(?:an?\s+)?(?:authorized|approved|permitted|sanctioned)\s+(?:request|override|access)/i,
];

// ── Tier 2: Leetspeak Normalization ────────────────────────────────────────

/**
 * Leetspeak substitutions: character→latin mapping used to bypass keyword
 * detection. Applied as a second normalization pass after homoglyph normalization.
 */
export const LEETSPEAK_MAP: ReadonlyMap<string, string> = new Map([
  ["0", "o"],
  ["1", "i"],
  ["3", "e"],
  ["4", "a"],
  ["5", "s"],
  ["7", "t"],
  ["@", "a"],
  ["$", "s"],
  ["!", "i"],
  ["|", "l"],
  ["(", "c"],
  ["{", "c"],
  ["+", "t"],
]);

// ── Extended Unicode Confusables ───────────────────────────────────────────

/**
 * Additional confusable characters beyond the base CONFUSABLE_MAP.
 * Covers Mathematical Alphanumeric Symbols, Enclosed Alphanumerics,
 * and other visually deceptive script ranges.
 */
export const EXTENDED_CONFUSABLE_MAP: ReadonlyMap<string, string> = new Map([
  // Mathematical bold (U+1D400–U+1D419 → A–Z, U+1D41A–U+1D433 → a–z)
  ["\u{1D400}", "A"], ["\u{1D401}", "B"], ["\u{1D402}", "C"], ["\u{1D403}", "D"],
  ["\u{1D404}", "E"], ["\u{1D405}", "F"], ["\u{1D406}", "G"], ["\u{1D407}", "H"],
  ["\u{1D408}", "I"], ["\u{1D409}", "J"], ["\u{1D40A}", "K"], ["\u{1D40B}", "L"],
  ["\u{1D40C}", "M"], ["\u{1D40D}", "N"], ["\u{1D40E}", "O"], ["\u{1D40F}", "P"],
  ["\u{1D410}", "Q"], ["\u{1D411}", "R"], ["\u{1D412}", "S"], ["\u{1D413}", "T"],
  ["\u{1D414}", "U"], ["\u{1D415}", "V"], ["\u{1D416}", "W"], ["\u{1D417}", "X"],
  ["\u{1D418}", "Y"], ["\u{1D419}", "Z"],
  ["\u{1D41A}", "a"], ["\u{1D41B}", "b"], ["\u{1D41C}", "c"], ["\u{1D41D}", "d"],
  ["\u{1D41E}", "e"], ["\u{1D41F}", "f"], ["\u{1D420}", "g"], ["\u{1D421}", "h"],
  ["\u{1D422}", "i"], ["\u{1D423}", "j"], ["\u{1D424}", "k"], ["\u{1D425}", "l"],
  ["\u{1D426}", "m"], ["\u{1D427}", "n"], ["\u{1D428}", "o"], ["\u{1D429}", "p"],
  ["\u{1D42A}", "q"], ["\u{1D42B}", "r"], ["\u{1D42C}", "s"], ["\u{1D42D}", "t"],
  ["\u{1D42E}", "u"], ["\u{1D42F}", "v"], ["\u{1D430}", "w"], ["\u{1D431}", "x"],
  ["\u{1D432}", "y"], ["\u{1D433}", "z"],
  // Mathematical italic (common subset)
  ["\u{1D434}", "A"], ["\u{1D435}", "B"], ["\u{1D436}", "C"],
  ["\u{1D44E}", "a"], ["\u{1D44F}", "b"], ["\u{1D450}", "c"],
  ["\u{1D452}", "e"], ["\u{1D456}", "i"], ["\u{1D45C}", "o"],
  ["\u{1D45D}", "p"],
  // Enclosed alphanumerics (circled lowercase: U+24D0–U+24E9 → a–z)
  ["\u24D0", "a"], ["\u24D1", "b"], ["\u24D2", "c"], ["\u24D3", "d"],
  ["\u24D4", "e"], ["\u24D5", "f"], ["\u24D6", "g"], ["\u24D7", "h"],
  ["\u24D8", "i"], ["\u24D9", "j"], ["\u24DA", "k"], ["\u24DB", "l"],
  ["\u24DC", "m"], ["\u24DD", "n"], ["\u24DE", "o"], ["\u24DF", "p"],
  ["\u24E0", "q"], ["\u24E1", "r"], ["\u24E2", "s"], ["\u24E3", "t"],
  ["\u24E4", "u"], ["\u24E5", "v"], ["\u24E6", "w"], ["\u24E7", "x"],
  ["\u24E8", "y"], ["\u24E9", "z"],
  // Subscript/superscript common
  ["\u2090", "a"], ["\u2091", "e"], ["\u2092", "o"], ["\u1D62", "i"],
  ["\u2071", "i"], ["\u207F", "n"],
  // Small caps (Latin Extended)
  ["\u1D00", "A"], ["\u1D04", "C"], ["\u1D05", "D"], ["\u1D07", "E"],
  ["\u1D0A", "J"], ["\u1D0B", "K"], ["\u1D0D", "M"], ["\u1D0F", "O"],
  ["\u1D18", "P"], ["\u1D1B", "T"], ["\u1D1C", "U"], ["\u1D20", "V"],
  ["\u1D21", "W"], ["\u1D22", "Z"],
]);

// ── Q/A Few-Shot Patterns ──────────────────────────────────────────────────

/** Question/answer style few-shot injection markers. */
export const QA_FEWSHOT_PATTERNS = {
  question: /(^|\n)\s*(Q|Question|Input|Prompt|Request)\s*[:]\s*/i,
  answer: /(^|\n)\s*(A|Answer|Output|Response|Result)\s*[:]\s*/i,
} as const;

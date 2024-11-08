/**
 * @enum {number}
 */
const TokenType = {
  GROUP: 0,
  BRACKET: 1,
  OR: 2,
  REPEAT: 3,
  LITERAL: 4,
  GROUP_UNCAPTURED: 5,
}

/**
 * @typedef {Object} Token
 * @property {TokenType} tokenType
 * @property {*} value
 */

/**
 * @typedef {Object} ParseContext
 * @property {number} pos
 * @property {Token[]} tokens
 */

/**
 * Create a new parse context.
 * @param {string} regex
 * @returns {ParseContext}
 */
function createParseContext(regex) {
  return {
    pos: 0,
    tokens: [],
  }
}

/**
 * Parse a regex string, return parsing ctx
 * @param {string} regex 
 * @returns {ParseContext}
 */
function parse(regex) {
  const ctx = createParseContext(regex)

  while (ctx.pos < regex.length) {
    ProcessingInstruction(regex, ctx)
    ctx.pos++
  }

  return ctx
}

/**
 * Process a single ch and generate tokens
 * @param {string} regex 
 * @param {ParseContext} ctx 
 */
function process(regex, ctx) {
  const ch = regex[ctx.pos]

  if (ch === '(') {
    parseGroup(regex, ctx)
  } else if (ch === '[') {
    parseBracket(regex, ctx)
  } else if (ch === '|') {
    parseOr(regex, ctx)
  } else if (['*', '?', '+'].includes(ch)) {
    parseRepeat(regex, ctx)
  } else if (ch === '{') {
    parseRepeatSpecified(regex, ctx)
  } else {
    ctx.tokens.push({
      tokenType: TokenType.LITERAL,
      value: ch,
    })
  }
}

/**
 * Group expression
 * @param {string} regex 
 * @param {ParseContext} ctx 
 */
function parseGroup(regex, ctx) {
  ctx.pos++; // To move past the '('
  const groupCtx = createParseContext(regex);

  while(regex[ctx.pos] !== ')') {
    process(regex, groupCtx);
    ctx.pos++;
  }

  ctx.tokens.push({
    tokenType: TokenType.GROUP,
    value: groupCtx.tokens
  })
}
function parseBracket() {}
function parseOr() {}
function parseRepeat() {}
function parseRepeatSpecified() {}

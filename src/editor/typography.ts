import { Extension, textInputRule } from '@tiptap/core';

/**
 * Smart typography, applied as you type. Hand-written rather than pulled from
 * a package because the package version also converts fractions, copyright
 * signs and guillemets, none of which belong in prose the owner is writing.
 *
 * Quote direction is decided by what precedes the quote: after whitespace or
 * an opening bracket it opens, otherwise it closes. That is the same rule
 * Word uses, and it gets contractions ("don't") right without special cases.
 */
const OPENS_AFTER = /(?:^|[\s([{—–‘“/])/;

export const SmartTypography = Extension.create({
  name: 'smartTypography',

  addInputRules() {
    return [
      textInputRule({ find: /--$/, replace: '—' }),
      textInputRule({ find: /\.\.\.$/, replace: '…' }),
      textInputRule({ find: new RegExp(`${OPENS_AFTER.source}(")$`), replace: '“' }),
      textInputRule({ find: /"$/, replace: '”' }),
      textInputRule({ find: new RegExp(`${OPENS_AFTER.source}(')$`), replace: '‘' }),
      textInputRule({ find: /'$/, replace: '’' }),
    ];
  },
});

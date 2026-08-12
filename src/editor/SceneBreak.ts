import { Node, mergeAttributes, nodeInputRule } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    sceneBreak: {
      setSceneBreak: () => ReturnType;
    };
  }
}

/**
 * A typed break between sections — a real node in the schema, not three
 * asterisks someone typed. It renders as a centred mark here and maps to a
 * centred `#` in manuscript export, `***` in markdown.
 *
 * The `—-` alternative in the input rule catches the case where smart
 * typography has already turned the first two hyphens into an em dash.
 */
export const SceneBreak = Node.create({
  name: 'sceneBreak',
  group: 'block',
  atom: true,
  selectable: true,

  parseHTML() {
    return [{ tag: 'div[data-scene-break]' }, { tag: 'hr[data-scene-break]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-scene-break': '', class: 'scene-break' }),
      '· · ·',
    ];
  },

  addCommands() {
    return {
      setSceneBreak:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name }),
    };
  },

  addInputRules() {
    return [nodeInputRule({ find: /^(?:---|—-|\*\*\*)\s$/, type: this.type })];
  },
});

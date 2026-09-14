import { Node, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    nestedList: {
      setNestedList: () => ReturnType;
    };
  }
}

/**
 * A named, collapsible group of normal editor blocks.
 *
 * Unlike a heading, this is explicitly a list structure: its name, open state
 * and children travel together. The children remain ordinary blocks, so a
 * nested list may hold paragraphs, bullets, tasks, pictures or another nested
 * list without a second content language.
 */
export const NestedList = Node.create({
  name: 'nestedList',
  group: 'block',
  content: 'block+',
  isolating: true,

  addAttributes() {
    return {
      title: { default: 'Untitled list' },
      collapsed: { default: false },
    };
  },

  parseHTML() {
    return [{ tag: 'section[data-nested-list]', contentElement: '.nested-list-body' }];
  },

  renderHTML({ HTMLAttributes }) {
    const title = String(HTMLAttributes.title ?? 'Untitled list');
    const collapsed = Boolean(HTMLAttributes.collapsed);
    return [
      'section',
      mergeAttributes(HTMLAttributes, {
        'data-nested-list': '',
        'data-collapsed': String(collapsed),
        class: 'nested-list',
      }),
      ['div', { class: 'nested-list-head' }, ['span', { class: 'nested-list-title' }, title]],
      ['div', { class: 'nested-list-body' }, 0],
    ];
  },

  addCommands() {
    return {
      setNestedList:
        () =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { title: 'Untitled list', collapsed: false },
            content: [{ type: 'paragraph' }],
          }),
    };
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      let current = node;
      const dom = document.createElement('section');
      dom.className = 'nested-list';
      dom.setAttribute('data-nested-list', '');

      const head = document.createElement('div');
      head.className = 'nested-list-head';
      head.contentEditable = 'false';
      dom.append(head);

      const title = document.createElement('input');
      title.type = 'text';
      title.className = 'nested-list-title';
      title.setAttribute('aria-label', 'Nested list title');
      head.append(title);

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'nested-list-toggle';
      toggle.setAttribute('aria-label', 'Collapse nested list');
      head.append(toggle);

      const body = document.createElement('div');
      body.className = 'nested-list-body';
      dom.append(body);

      const position = (): number | null => {
        const value = getPos();
        return typeof value === 'number' ? value : null;
      };
      const updateAttrs = (attrs: Record<string, unknown>) => {
        const pos = position();
        if (pos === null) return;
        editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, attrs));
      };
      title.addEventListener('input', () => updateAttrs({ ...current.attrs, title: title.value }));
      title.addEventListener('mousedown', (event) => event.stopPropagation());
      toggle.addEventListener('mousedown', (event) => event.preventDefault());
      toggle.addEventListener('click', (event) => {
        event.preventDefault();
        updateAttrs({ ...current.attrs, collapsed: !current.attrs.collapsed });
        editor.view.focus();
      });

      const paint = () => {
        const collapsed = Boolean(current.attrs.collapsed);
        dom.classList.toggle('is-collapsed', collapsed);
        dom.setAttribute('data-collapsed', String(collapsed));
        if (title.value !== current.attrs.title) title.value = String(current.attrs.title ?? '');
        toggle.setAttribute('aria-label', collapsed ? 'Expand nested list' : 'Collapse nested list');
        toggle.setAttribute('aria-expanded', String(!collapsed));
        toggle.title = collapsed ? 'Expand nested list' : 'Collapse nested list';
      };
      paint();

      return {
        dom,
        contentDOM: body,
        update(next) {
          if (next.type !== current.type) return false;
          current = next;
          paint();
          return true;
        },
        stopEvent: (event) => event.target instanceof globalThis.Node && head.contains(event.target),
        ignoreMutation: (mutation) => mutation.target instanceof globalThis.Node && head.contains(mutation.target),
      };
    };
  },
});

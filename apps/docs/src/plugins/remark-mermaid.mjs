import { visit } from 'unist-util-visit';

// Replaces ```mermaid fenced code blocks with an empty <pre class="mermaid">
// carrying the base64-encoded diagram source. src/components/Head.astro renders
// it in the browser. Rendering client-side (instead of the stock rehype-mermaid
// build-time strategy) is deliberate: it keeps the build off a headless browser
// (Playwright), which is heavy and CI-fragile, and it lets diagrams follow the
// reader's light/dark theme. A malformed diagram therefore fails softly at
// render time rather than breaking the whole build.
export function remarkMermaid() {
  return function transform(tree) {
    visit(tree, 'code', (node, index, parent) => {
      if (!parent || typeof index !== 'number' || node.lang !== 'mermaid') return;
      const encoded = Buffer.from(node.value, 'utf8').toString('base64');
      parent.children[index] = {
        type: 'html',
        value: `<pre class="mermaid not-content" data-mermaid="${encoded}" role="img" aria-label="Diagram"></pre>`,
      };
    });
  };
}

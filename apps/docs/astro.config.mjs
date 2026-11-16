import { unified } from '@astrojs/markdown-remark';
import mdx from '@astrojs/mdx';
import starlight from '@astrojs/starlight';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

import { PRODUCT_NAME } from '@repo/shared/constants';

import { remarkMermaid } from './src/plugins/remark-mermaid.mjs';

// Static, single-origin hosting: default base '/' (unlike apps/web,
// which uses base './' for the Electron file:// shell). Pagefind search is on
// by default and indexes the static build; no extra config needed.
export default defineConfig({
  // Astro 7 defaults to the Satteri markdown pipeline; remark plugins now ride
  // on the unified() processor from @astrojs/markdown-remark instead of the
  // deprecated markdown.remarkPlugins option (removed in Astro 8).
  markdown: {
    processor: unified({ remarkPlugins: [remarkMermaid] }),
  },
  integrations: [
    starlight({
      // The name comes from @repo/shared rather than a literal, for the same
      // reason the sidebar and the auth panel read it: PRODUCT_NAME is the one
      // place a product built on the starter renames itself.
      title: `${PRODUCT_NAME} Docs`,
      description: `Documentation for ${PRODUCT_NAME}, an open-source Vite + NestJS + Electron SaaS starter monorepo.`,
      favicon: '/favicon.svg',
      // Two files rather than one, because the mark's plate is the brand fill
      // and that token differs between the modes. Starlight picks by theme.
      logo: {
        light: './src/assets/logo-light.svg',
        dark: './src/assets/logo-dark.svg',
        alt: `${PRODUCT_NAME} Docs`,
        replacesTitle: false,
      },
      customCss: ['./src/styles/theme.css'],
      // The override map is wired for deep theming. Head hosts the fonts and the
      // client-side Mermaid renderer; Footer appends the branding line.
      components: {
        Head: './src/components/Head.astro',
        Footer: './src/components/Footer.astro',
      },
      social: [
        {
          icon: 'github',
          label: 'Repository',
          href: 'https://github.com/Shironex/nest-vite-saas-starter',
        },
      ],
      sidebar: [
        { label: 'Architecture', items: [{ autogenerate: { directory: 'architecture' } }] },
        { label: 'Backend', items: [{ autogenerate: { directory: 'backend' } }] },
        {
          label: 'Frontend & Desktop',
          items: [{ autogenerate: { directory: 'frontend' } }],
        },
        { label: 'Operations', items: [{ autogenerate: { directory: 'operations' } }] },
      ],
    }),
    mdx(),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});

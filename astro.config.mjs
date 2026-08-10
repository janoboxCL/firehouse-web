import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://firehousecheer.cl',
  trailingSlash: 'never',
  build: { format: 'file' },
  integrations: [sitemap({ filter: (pagina) => !pagina.includes('/404') })],
});

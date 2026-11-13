export function GET() {
  return Response.json(
    {
      id: '/admin',
      name: 'Burger Tilín Admin',
      short_name: 'Tilín Admin',
      start_url: '/admin',
      scope: '/admin',
      display: 'standalone',
      lang: 'es-AR',
      background_color: '#fffaf2',
      theme_color: '#1e1c19',
      icons: [192, 512].map((size) => ({
        src: `/admin-icons/icon-${size}.png`,
        sizes: `${size}x${size}`,
        type: 'image/png',
      })),
    },
    { headers: { 'Content-Type': 'application/manifest+json' } },
  );
}

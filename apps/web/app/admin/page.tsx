import type { Metadata } from 'next';
import Admin from '../../components/admin';

export const metadata: Metadata = {
  title: 'Burger Tilín Admin',
  manifest: '/admin/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Tilín Admin', statusBarStyle: 'default' },
  icons: {
    icon: { url: '/admin-icons/favicon.png', type: 'image/png', sizes: '64x64' },
    apple: '/admin-icons/apple.png',
  },
};

export default function Page() {
  return <Admin />;
}

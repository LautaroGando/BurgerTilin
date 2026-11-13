import type { Metadata } from 'next';
import Admin from '../../components/admin';

export const metadata: Metadata = {
  title: 'Burger Tilín Admin',
  manifest: '/admin/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Tilín Admin', statusBarStyle: 'default' },
  icons: { apple: '/admin-icons/apple.png' },
};

export default function Page() {
  return <Admin />;
}

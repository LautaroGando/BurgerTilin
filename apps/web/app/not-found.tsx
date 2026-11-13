import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Brand } from '../components/ui';

export const metadata: Metadata = {
  title: 'Página no encontrada · Burger Tilín',
};

export default function NotFound() {
  return (
    <div className="storefront">
      <header className="shop-nav">
        <Link href="/menu" aria-label="Burger Tilín, inicio">
          <Brand />
        </Link>
      </header>
      <main className="shop-hero">
        <div className="hero-photo" aria-hidden="true" />
        <div className="hero-copy">
          <span className="eyebrow">ERROR 404</span>
          <h1>
            Esta página no existe<span>.</span>
          </h1>
          <p>Volvé al menú para ver nuestras hamburguesas, combos y promos.</p>
          <Link href="/menu" className="primary">
            Volver al menú <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </div>
      </main>
    </div>
  );
}

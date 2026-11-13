import type { Metadata } from 'next';
import DeliveryMap from '../../components/delivery-map';

export const metadata: Metadata = {
  title: 'Zona de envío gratis · Burger Tilín',
};

export default function DeliveryMapPage() {
  return (
    <main className="delivery-map-page" aria-label="Zona de envío gratis">
      <DeliveryMap sizes="(max-width: 1045px) calc(100vw - 32px), 1013px" />
    </main>
  );
}

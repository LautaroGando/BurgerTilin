import type { Metadata } from 'next';
import DeliveryMap from '../../components/delivery-map';

export const metadata: Metadata = {
  title: 'Zona de envío gratis · Burger Tilín',
};

export default function DeliveryMapPage() {
  return (
    <main className="delivery-map-page" aria-label="Zona de envío gratis">
      <DeliveryMap />
    </main>
  );
}

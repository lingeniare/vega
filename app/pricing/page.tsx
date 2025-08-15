// Force dynamic rendering to access headers
export const dynamic = 'force-dynamic';

import { getCurrentUser } from '@/app/actions';
import PricingTable from './_component/pricing-table';

export default async function PricingPage() {
  const user = await getCurrentUser();

  // Extract subscription details from unified user data
  const subscriptionDetails = user?.robokassaSubscription
    ? {
        hasSubscription: true,
        subscription: {
          ...user.robokassaSubscription,
          productId: user.robokassaSubscription.planType, // Map planType to productId for compatibility
          organizationId: null,
        },
      }
    : { hasSubscription: false };

  return (
    <div className="w-full">
      <PricingTable subscriptionDetails={subscriptionDetails} user={user} />
    </div>
  );
}

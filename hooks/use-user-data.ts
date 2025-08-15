import { useQuery } from '@tanstack/react-query';
import { getCurrentUser } from '@/app/actions';
import { type ComprehensiveUserData } from '@/lib/user-data';
import { shouldBypassRateLimits } from '@/ai/providers';

export function useUserData() {
  const {
    data: userData,
    isLoading,
    error,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ['comprehensive-user-data'],
    queryFn: getCurrentUser,
    staleTime: 1000 * 60 * 30, // 30 minutes - matches server cache
    gcTime: 1000 * 60 * 60, // 1 hour cache retention
    refetchOnWindowFocus: false,
    retry: 2,
  });

  // Helper function to check if user should have unlimited access for specific models
  const shouldBypassLimitsForModel = (selectedModel: string) => {
    return shouldBypassRateLimits(selectedModel, userData);
  };

  return {
    // Core user data
    user: userData,
    isLoading,
    error,
    refetch,
    isRefetching,

    // Quick access to commonly used properties
    isProUser: Boolean(userData?.isProUser),
    proSource: userData?.proSource || 'none',
    subscriptionStatus: userData?.subscriptionStatus || 'none',

    // Robokassa subscription details
    robokassaSubscription: userData?.robokassaSubscription,
    hasRobokassaSubscription: Boolean(userData?.robokassaSubscription),

    // Legacy fields for backward compatibility
    polarSubscription: userData?.robokassaSubscription, // Map to robokassa for compatibility
    hasPolarSubscription: Boolean(userData?.robokassaSubscription),
    dodoPayments: null, // Deprecated
    hasDodoPayments: false, // Deprecated
    dodoExpiresAt: userData?.robokassaSubscription?.currentPeriodEnd,
    isDodoExpiring: Boolean(userData?.robokassaSubscription?.status === 'active' && userData?.robokassaSubscription?.currentPeriodEnd && new Date(userData.robokassaSubscription.currentPeriodEnd).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000),
    isDodoExpired: Boolean(userData?.robokassaSubscription?.status === 'canceled' || userData?.robokassaSubscription?.status === 'expired'),

    // Payment history
    paymentHistory: userData?.paymentHistory || [],

    // Rate limiting helpers
    shouldCheckLimits: !isLoading && userData && !userData.isProUser,
    shouldBypassLimitsForModel,

    // Subscription status checks
    hasActiveSubscription: userData?.subscriptionStatus === 'active',
    isSubscriptionCanceled: userData?.subscriptionStatus === 'canceled',
    isSubscriptionExpired: userData?.subscriptionStatus === 'expired',
    hasNoSubscription: userData?.subscriptionStatus === 'none',

    // Legacy compatibility helpers
    subscriptionData: userData?.robokassaSubscription
      ? {
          hasSubscription: true,
          subscription: userData.robokassaSubscription,
        }
      : { hasSubscription: false },

    // Map robokassaSubscription to legacy dodoProStatus structure for settings dialog
    dodoProStatus: userData?.robokassaSubscription
      ? {
          isProUser: userData.proSource === 'robokassa' && userData.isProUser,
          hasPayments: true,
          expiresAt: userData.robokassaSubscription.currentPeriodEnd,
          mostRecentPayment: null, // Not available in robokassa structure
          daysUntilExpiration: Math.ceil((new Date(userData.robokassaSubscription.currentPeriodEnd).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
          isExpired: userData.robokassaSubscription.status === 'canceled' || userData.robokassaSubscription.status === 'expired',
          isExpiringSoon: userData.robokassaSubscription.status === 'active' && new Date(userData.robokassaSubscription.currentPeriodEnd).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000,
          source: userData.proSource,
        }
      : null,

    expiresAt: userData?.robokassaSubscription?.currentPeriodEnd,
  };
}

// Lightweight hook for components that only need to know if user is pro
export function useIsProUser() {
  const { isProUser, isLoading } = useUserData();
  return { isProUser, isLoading };
}

// Hook for components that need subscription status but not all user data
export function useSubscriptionStatus() {
  const {
    subscriptionStatus,
    proSource,
    hasActiveSubscription,
    isSubscriptionCanceled,
    isSubscriptionExpired,
    hasNoSubscription,
    isLoading,
  } = useUserData();

  return {
    subscriptionStatus,
    proSource,
    hasActiveSubscription,
    isSubscriptionCanceled,
    isSubscriptionExpired,
    hasNoSubscription,
    isLoading,
  };
}

// Export the comprehensive type for components that need it
export type { ComprehensiveUserData };

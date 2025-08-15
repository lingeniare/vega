'use client';

import { useEffect } from 'react';
import { useUserData } from '@/hooks/use-user-data';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { type ComprehensiveUserData } from '@/lib/user-data';
import { shouldBypassRateLimits } from '@/ai/providers';

export function useCachedUserData() {
  // Get fresh data from the existing hook
  const { user: freshUser, isLoading: isFreshLoading, error, refetch, isRefetching, ...otherUserData } = useUserData();

  // Cache user data in localStorage
  const [cachedUser, setCachedUser] = useLocalStorage<ComprehensiveUserData | null>('scira-user-data', null);

  // Update cache when fresh data is available
  useEffect(() => {
    if (freshUser && !isFreshLoading) {
      setCachedUser(freshUser);
    }
  }, [freshUser, isFreshLoading, setCachedUser]);

  // Clear cache when user logs out (no fresh user and not loading)
  useEffect(() => {
    if (!freshUser && !isFreshLoading && cachedUser) {
      setCachedUser(null);
    }
  }, [freshUser, isFreshLoading, cachedUser, setCachedUser]);

  // Use cached data if available, otherwise use fresh data
  const user = cachedUser || freshUser;

  // Show loading only if we have no cached data and fresh data is loading
  const isLoading = !cachedUser && isFreshLoading;

  // Recalculate derived properties based on current user data
  const isProUser = Boolean(user?.isProUser);
  const proSource = user?.proSource || 'none';
  const subscriptionStatus = user?.subscriptionStatus || 'none';

  // Helper function to check if user should have unlimited access for specific models
  const shouldBypassLimitsForModel = (selectedModel: string) => {
    return shouldBypassRateLimits(selectedModel, user);
  };

  return {
    // Core user data
    user,
    isLoading,
    error,
    refetch,
    isRefetching,

    // Quick access to commonly used properties
    isProUser,
    proSource,
    subscriptionStatus,

    // Robokassa subscription details
    robokassaSubscription: user?.robokassaSubscription,
    hasRobokassaSubscription: Boolean(user?.robokassaSubscription),

    // Legacy fields for backward compatibility
    polarSubscription: user?.robokassaSubscription, // Map to robokassa for compatibility
    hasPolarSubscription: Boolean(user?.robokassaSubscription),
    dodoPayments: null, // Deprecated
    hasDodoPayments: false, // Deprecated
    dodoExpiresAt: user?.robokassaSubscription?.currentPeriodEnd,
    isDodoExpiring: Boolean(user?.robokassaSubscription?.status === 'active' && user?.robokassaSubscription?.currentPeriodEnd && new Date(user.robokassaSubscription.currentPeriodEnd).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000),
    isDodoExpired: Boolean(user?.robokassaSubscription?.status === 'canceled' || user?.robokassaSubscription?.status === 'expired'),

    // Payment history
    paymentHistory: user?.paymentHistory || [],

    // Rate limiting helpers
    shouldCheckLimits: Boolean(!isLoading && user && !user.isProUser),
    shouldBypassLimitsForModel,

    // Subscription status checks
    hasActiveSubscription: user?.subscriptionStatus === 'active',
    isSubscriptionCanceled: user?.subscriptionStatus === 'canceled',
    isSubscriptionExpired: user?.subscriptionStatus === 'expired',
    hasNoSubscription: user?.subscriptionStatus === 'none',

    // Legacy compatibility helpers
    subscriptionData: user?.robokassaSubscription
      ? {
          hasSubscription: true,
          subscription: user.robokassaSubscription,
        }
      : { hasSubscription: false },

    // Map robokassaSubscription to legacy dodoProStatus structure for settings dialog
    dodoProStatus: user?.robokassaSubscription
      ? {
          isProUser: proSource === 'robokassa' && isProUser,
          hasPayments: true,
          expiresAt: user.robokassaSubscription.currentPeriodEnd,
          mostRecentPayment: null, // Not available in robokassa structure
          daysUntilExpiration: Math.ceil((new Date(user.robokassaSubscription.currentPeriodEnd).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
          isExpired: user.robokassaSubscription.status === 'canceled' || user.robokassaSubscription.status === 'expired',
          isExpiringSoon: user.robokassaSubscription.status === 'active' && new Date(user.robokassaSubscription.currentPeriodEnd).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000,
          source: proSource,
        }
      : null,

    expiresAt: user?.robokassaSubscription?.currentPeriodEnd,

    // Additional utilities
    isCached: Boolean(cachedUser),
    clearCache: () => setCachedUser(null),
  };
}

// Lightweight hook for components that only need to know if user is pro
export function useCachedIsProUser() {
  const { isProUser, isLoading } = useCachedUserData();
  return { isProUser, isLoading };
}

// Hook for components that need subscription status but not all user data
export function useCachedSubscriptionStatus() {
  const {
    subscriptionStatus,
    proSource,
    hasActiveSubscription,
    isSubscriptionCanceled,
    isSubscriptionExpired,
    hasNoSubscription,
    isLoading,
  } = useCachedUserData();

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

import { eq } from 'drizzle-orm';
import { subscription, payment } from './db/schema';
import { db } from './db';
import { auth } from './auth';
import { headers } from 'next/headers';
import {
  subscriptionCache,
  createSubscriptionKey,
  getProUserStatus,
  setProUserStatus,
} from './performance-cache';

// Robokassa subscription configuration
const ROBOKASSA_CONFIG = {
  gracePeriodDays: 3, // Grace period for failed payments
  maxFailedPayments: 3, // Max failed payments before cancellation
};

export type SubscriptionDetails = {
  id: string;
  planType: string;
  status: string;
  amount: number;
  currency: string;
  recurringInterval: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  merchantLogin: string;
  recurringId: string | null;
  failedPaymentsCount: number;
};

export type SubscriptionDetailsResult = {
  hasSubscription: boolean;
  subscription?: SubscriptionDetails;
  error?: string;
  errorType?: 'CANCELED' | 'EXPIRED' | 'GENERAL';
};

// Helper function to check DodoPayments status for Indian users
// DEPRECATED: Replaced by Robokassa integration
/*
async function checkDodoPaymentsProStatus(userId: string): Promise<boolean> {
  try {
    // Check cache first
    const cachedStatus = getDodoProStatus(userId);
    if (cachedStatus !== null) {
      return cachedStatus.isProUser;
    }

    // Check cache for payments to avoid DB hit
    let userPayments = getDodoPayments(userId);
    if (!userPayments) {
      userPayments = await db.select().from(payment).where(eq(payment.userId, userId));
      setDodoPayments(userId, userPayments);
    }

    // Get the most recent successful payment
    const successfulPayments = userPayments
      .filter((p: any) => p.status === 'succeeded')
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (successfulPayments.length === 0) {
      const statusData = { isProUser: false, hasPayments: false };
      setDodoProStatus(userId, statusData);
      console.log('No successful payments found');
      return false;
    }

    // Check if the most recent payment is within the subscription duration
    const mostRecentPayment = successfulPayments[0];
    const paymentDate = new Date(mostRecentPayment.createdAt);
    const subscriptionEndDate = new Date(paymentDate);
    subscriptionEndDate.setMonth(subscriptionEndDate.getMonth() + DODO_SUBSCRIPTION_DURATION_MONTHS);

    const now = new Date();
    const isActive = subscriptionEndDate > now;

    // Cache the result
    const statusData = {
      isProUser: isActive,
      hasPayments: true,
      mostRecentPayment: mostRecentPayment.createdAt,
      subscriptionEndDate: subscriptionEndDate.toISOString(),
    };
    setDodoProStatus(userId, statusData);

    return isActive;
  } catch (error) {
    console.error('Error checking DodoPayments status:', error);
    return false;
  }
}
*/

// Function to check Pro status from Robokassa subscriptions
async function getRobokassaProStatus(
  userId: string,
): Promise<{ isProUser: boolean; source: 'robokassa' | 'none'; planType?: string }> {
  try {
    // Check Robokassa subscriptions
    const userSubscriptions = await db.select().from(subscription).where(eq(subscription.userId, userId));
    
    // Find active subscription or subscription within grace period
    const now = new Date();
    const gracePeriod = new Date(now.getTime() - (ROBOKASSA_CONFIG.gracePeriodDays * 24 * 60 * 60 * 1000));
    
    const activeSubscription = userSubscriptions.find((sub) => {
      if (sub.status === 'active') {
        // Check if subscription is still valid
        const periodEnd = new Date(sub.currentPeriodEnd);
        return periodEnd > now;
      }
      
      // Check for subscriptions in grace period
      if (sub.status === 'expired' && sub.failedPaymentsCount < ROBOKASSA_CONFIG.maxFailedPayments) {
        const periodEnd = new Date(sub.currentPeriodEnd);
        return periodEnd > gracePeriod;
      }
      
      return false;
    });

    if (activeSubscription) {
      console.log('🔥 Robokassa subscription found for user:', userId, 'Plan:', activeSubscription.planType);
      return { 
        isProUser: true, 
        source: 'robokassa',
        planType: activeSubscription.planType
      };
    }

    return { isProUser: false, source: 'none' };
  } catch (error) {
    console.error('Error getting Robokassa pro status:', error);
    return { isProUser: false, source: 'none' };
  }
}

export async function getSubscriptionDetails(): Promise<SubscriptionDetailsResult> {
  'use server';

  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user?.id) {
      return { hasSubscription: false };
    }

    // Check cache first
    const cacheKey = createSubscriptionKey(session.user.id);
    const cached = subscriptionCache.get(cacheKey);
    if (cached) {
      // Update pro user status with Robokassa check
      const proStatus = await getRobokassaProStatus(session.user.id);
      setProUserStatus(session.user.id, proStatus.isProUser);
      return cached;
    }

    const userSubscriptions = await db.select().from(subscription).where(eq(subscription.userId, session.user.id));

    if (!userSubscriptions.length) {
      // No subscriptions found
      const proStatus = await getRobokassaProStatus(session.user.id);
      const result = { hasSubscription: false };
      subscriptionCache.set(cacheKey, result);
      setProUserStatus(session.user.id, proStatus.isProUser);
      return result;
    }

    // Get the most recent active subscription or subscription within grace period
    const now = new Date();
    const gracePeriod = new Date(now.getTime() - (ROBOKASSA_CONFIG.gracePeriodDays * 24 * 60 * 60 * 1000));
    
    const activeSubscription = userSubscriptions
      .filter((sub) => {
        if (sub.status === 'active') {
          const periodEnd = new Date(sub.currentPeriodEnd);
          return periodEnd > now;
        }
        
        // Include subscriptions in grace period
        if (sub.status === 'expired' && sub.failedPaymentsCount < ROBOKASSA_CONFIG.maxFailedPayments) {
          const periodEnd = new Date(sub.currentPeriodEnd);
          return periodEnd > gracePeriod;
        }
        
        return false;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

    if (!activeSubscription) {
      // Check for canceled or expired subscriptions
      const latestSubscription = userSubscriptions.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )[0];

      if (latestSubscription) {
        const now = new Date();
        const isExpired = new Date(latestSubscription.currentPeriodEnd) < now;
        const isCanceled = latestSubscription.status === 'canceled';

        const result = {
          hasSubscription: true,
          subscription: {
            id: latestSubscription.id,
            planType: latestSubscription.planType,
            status: latestSubscription.status,
            amount: latestSubscription.amount,
            currency: latestSubscription.currency,
            recurringInterval: latestSubscription.recurringInterval,
            currentPeriodStart: latestSubscription.currentPeriodStart,
            currentPeriodEnd: latestSubscription.currentPeriodEnd,
            cancelAtPeriodEnd: latestSubscription.cancelAtPeriodEnd,
            canceledAt: latestSubscription.canceledAt,
            merchantLogin: latestSubscription.merchantLogin,
            recurringId: latestSubscription.recurringId,
            failedPaymentsCount: latestSubscription.failedPaymentsCount,
          },
          error: isCanceled
            ? 'Subscription has been canceled'
            : isExpired
              ? 'Subscription has expired'
              : 'Subscription is not active',
          errorType: (isCanceled ? 'CANCELED' : isExpired ? 'EXPIRED' : 'GENERAL') as
            | 'CANCELED'
            | 'EXPIRED'
            | 'GENERAL',
        };
        subscriptionCache.set(cacheKey, result);
        // Cache comprehensive pro user status (might have DodoPayments even if Polar is inactive)
        const proStatus = await getRobokassaProStatus(session.user.id);
        setProUserStatus(session.user.id, proStatus.isProUser);
        return result;
      }

      const fallbackResult = { hasSubscription: false };
      subscriptionCache.set(cacheKey, fallbackResult);
      // Cache comprehensive pro user status
      const proStatus = await getRobokassaProStatus(session.user.id);
      setProUserStatus(session.user.id, proStatus.isProUser);
      return fallbackResult;
    }

    const result = {
      hasSubscription: true,
      subscription: {
        id: activeSubscription.id,
        planType: activeSubscription.planType,
        status: activeSubscription.status,
        amount: activeSubscription.amount,
        currency: activeSubscription.currency,
        recurringInterval: activeSubscription.recurringInterval,
        currentPeriodStart: activeSubscription.currentPeriodStart,
        currentPeriodEnd: activeSubscription.currentPeriodEnd,
        cancelAtPeriodEnd: activeSubscription.cancelAtPeriodEnd,
        canceledAt: activeSubscription.canceledAt,
        merchantLogin: activeSubscription.merchantLogin,
        recurringId: activeSubscription.recurringId,
        failedPaymentsCount: activeSubscription.failedPaymentsCount,
      },
    };
    subscriptionCache.set(cacheKey, result);
    // Cache pro user status as true for active Polar subscription
    setProUserStatus(session.user.id, true);
    return result;
  } catch (error) {
    console.error('Error fetching subscription details:', error);
    return {
      hasSubscription: false,
      error: 'Failed to load subscription details',
      errorType: 'GENERAL',
    };
  }
}

// Simple helper to check if user has an active subscription
export async function isUserSubscribed(): Promise<boolean> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user?.id) {
      return false;
    }

    // Use Robokassa subscription check
    const proStatus = await getRobokassaProStatus(session.user.id);
    return proStatus.isProUser;
  } catch (error) {
    console.error('Error checking user subscription status:', error);
    return false;
  }
}

// Fast pro user status check using cache
export async function isUserProCached(): Promise<boolean> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user?.id) {
    return false;
  }

  // Try cache first
  const cached = getProUserStatus(session.user.id);
  if (cached !== null) {
    return cached;
  }

  // Fallback to Robokassa check
  const proStatus = await getRobokassaProStatus(session.user.id);
  setProUserStatus(session.user.id, proStatus.isProUser);
  return proStatus.isProUser;
}

// Helper to check if user has access to a specific product/tier
// DEPRECATED: Replaced by Robokassa integration
/*
export async function hasAccessToProduct(productId: string): Promise<boolean> {
  const result = await getSubscriptionDetails();
  return (
    result.hasSubscription && result.subscription?.status === 'active' && result.subscription?.productId === productId
  );
}
*/

// Helper to get user's current subscription status
// DEPRECATED: Replaced by Robokassa integration
/*
export async function getUserSubscriptionStatus(): Promise<'active' | 'canceled' | 'expired' | 'none'> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user?.id) {
      return 'none';
    }

    // First check comprehensive Pro status (includes DodoPayments)
    const proStatus = await getRobokassaProStatus(session.user.id);

    if (proStatus.isProUser) {
      if (proStatus.source === 'robokassa') {
        return 'active'; // Robokassa successful payment = active
      }
    }

    // For Polar subscriptions, get detailed status
    const result = await getSubscriptionDetails();

    if (!result.hasSubscription) {
      return proStatus.isProUser ? 'active' : 'none';
    }

    if (result.subscription?.status === 'active') {
      return 'active';
    }

    if (result.errorType === 'CANCELED') {
      return 'canceled';
    }

    if (result.errorType === 'EXPIRED') {
      return 'expired';
    }

    return 'none';
  } catch (error) {
    console.error('Error getting user subscription status:', error);
    return 'none';
  }
}
*/

// Helper to get DodoPayments expiration date
// DEPRECATED: Replaced by Robokassa integration
/*
export async function getDodoPaymentsExpirationDate(): Promise<Date | null> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user?.id) {
      return null;
    }

    // Check cache first
    const cachedExpiration = getDodoPaymentExpiration(session.user.id);
    if (cachedExpiration !== null) {
      return cachedExpiration.expirationDate ? new Date(cachedExpiration.expirationDate) : null;
    }

    // Check cache for payments to avoid DB hit
    let userPayments = getDodoPayments(session.user.id);
    if (!userPayments) {
      userPayments = await db.select().from(payment).where(eq(payment.userId, session.user.id));
      setDodoPayments(session.user.id, userPayments);
    }

    const successfulPayments = userPayments
      .filter((p: any) => p.status === 'succeeded')
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (successfulPayments.length === 0) {
      const expirationData = { expirationDate: null };
      setDodoPaymentExpiration(session.user.id, expirationData);
      return null;
    }

    // Calculate expiration date based on payment date and configured duration
    const mostRecentPayment = successfulPayments[0];
    const expirationDate = new Date(mostRecentPayment.createdAt);
    expirationDate.setMonth(expirationDate.getMonth() + DODO_SUBSCRIPTION_DURATION_MONTHS);

    // Cache the result
    const expirationData = {
      expirationDate: expirationDate.toISOString(),
      paymentDate: mostRecentPayment.createdAt,
    };
    setDodoPaymentExpiration(session.user.id, expirationData);

    return expirationDate;
  } catch (error) {
    console.error('Error getting DodoPayments expiration date:', error);
    return null;
  }
}
*/

// Export the comprehensive pro status function for UI components that need to know the source
// DEPRECATED: Replaced by Robokassa integration
/*
export async function getProStatusWithSource(): Promise<{
  isProUser: boolean;
  source: 'polar' | 'dodo' | 'none';
  expiresAt?: Date;
}> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user?.id) {
      return { isProUser: false, source: 'none' };
    }

    const proStatus = await getRobokassaProStatus(session.user.id);

    // If Pro status comes from Robokassa, include expiration date
    if (proStatus.source === 'robokassa' && proStatus.isProUser) {
      const expiresAt = await getDodoPaymentsExpirationDate();
      return { ...proStatus, expiresAt: expiresAt || undefined };
    }

    return proStatus;
  } catch (error) {
    console.error('Error getting pro status with source:', error);
    return { isProUser: false, source: 'none' };
  }
}
*/

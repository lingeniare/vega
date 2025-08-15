import 'server-only';

import { eq } from 'drizzle-orm';
import { subscription, payment, user } from './db/schema';
import { db } from './db';
import { auth } from './auth';
import { headers } from 'next/headers';
// Robokassa subscription configuration
const ROBOKASSA_CONFIG = {
  gracePeriodDays: 3, // Grace period for failed payments
  maxFailedPayments: 3, // Max failed payments before cancellation
};

// Single comprehensive user data type
export type ComprehensiveUserData = {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
  isProUser: boolean;
  proSource: 'robokassa' | 'none';
  subscriptionStatus: 'active' | 'canceled' | 'expired' | 'none';
  robokassaSubscription?: {
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
  // Payment history
  paymentHistory: any[];
};

const userDataCache = new Map<string, { data: ComprehensiveUserData; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCachedUserData(userId: string): ComprehensiveUserData | null {
  const cached = userDataCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }
  if (cached) {
    userDataCache.delete(userId);
  }
  return null;
}

function setCachedUserData(userId: string, data: ComprehensiveUserData): void {
  userDataCache.set(userId, {
    data,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

export function clearUserDataCache(userId: string): void {
  userDataCache.delete(userId);
}

export function clearAllUserDataCache(): void {
  userDataCache.clear();
}

export async function getComprehensiveUserData(): Promise<ComprehensiveUserData | null> {
  try {
    // Get session once
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user?.id) {
      return null;
    }

    const userId = session.user.id;

    // Check cache first
    const cached = getCachedUserData(userId);
    if (cached) {
      return cached;
    }

    // Fetch all data in parallel - SINGLE DATABASE OPERATION SET
    const [userData, robokassaSubscriptions, robokassaPayments] = await Promise.all([
      // User basic data
      db
        .select()
        .from(user)
        .where(eq(user.id, userId))
        .then((rows) => rows[0]),
      // Robokassa subscriptions
      db.select().from(subscription).where(eq(subscription.userId, userId)),
      // Robokassa payments
      db.select().from(payment).where(eq(payment.userId, userId)),
    ]);

    if (!userData) {
      return null;
    }

    // Process Robokassa subscription with grace period logic
    const now = new Date();
    const gracePeriod = new Date(now.getTime() - (ROBOKASSA_CONFIG.gracePeriodDays * 24 * 60 * 60 * 1000));
    
    const activeRobokassaSubscription = robokassaSubscriptions.find((sub) => {
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

    // Determine overall Pro status and source
    let isProUser = false;
    let proSource: 'robokassa' | 'none' = 'none';
    let subscriptionStatus: 'active' | 'canceled' | 'expired' | 'none' = 'none';

    if (activeRobokassaSubscription) {
      isProUser = true;
      proSource = 'robokassa';
      subscriptionStatus = 'active';
    } else {
      // Check for expired/canceled Robokassa subscriptions
      const latestRobokassaSubscription = robokassaSubscriptions.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )[0];

      if (latestRobokassaSubscription) {
        const now = new Date();
        const isExpired = new Date(latestRobokassaSubscription.currentPeriodEnd) < now;
        const isCanceled = latestRobokassaSubscription.status === 'canceled';

        if (isCanceled) {
          subscriptionStatus = 'canceled';
        } else if (isExpired) {
          subscriptionStatus = 'expired';
        }
      }
    }

    // Build comprehensive user data
    const comprehensiveData: ComprehensiveUserData = {
      id: userData.id,
      email: userData.email,
      emailVerified: userData.emailVerified,
      name: userData.name || userData.email.split('@')[0], // Fallback to email prefix if name is null
      image: userData.image,
      createdAt: userData.createdAt,
      updatedAt: userData.updatedAt,
      isProUser,
      proSource,
      subscriptionStatus,
      paymentHistory: robokassaPayments,
    };

    // Add Robokassa subscription details if exists
    if (activeRobokassaSubscription) {
      comprehensiveData.robokassaSubscription = {
        id: activeRobokassaSubscription.id,
        planType: activeRobokassaSubscription.planType,
        status: activeRobokassaSubscription.status,
        amount: activeRobokassaSubscription.amount,
        currency: activeRobokassaSubscription.currency,
        recurringInterval: activeRobokassaSubscription.recurringInterval,
        currentPeriodStart: activeRobokassaSubscription.currentPeriodStart,
        currentPeriodEnd: activeRobokassaSubscription.currentPeriodEnd,
        cancelAtPeriodEnd: activeRobokassaSubscription.cancelAtPeriodEnd,
        canceledAt: activeRobokassaSubscription.canceledAt,
        merchantLogin: activeRobokassaSubscription.merchantLogin,
        recurringId: activeRobokassaSubscription.recurringId,
        failedPaymentsCount: activeRobokassaSubscription.failedPaymentsCount,
      };
    }

    // Cache the result
    setCachedUserData(userId, comprehensiveData);

    return comprehensiveData;
  } catch (error) {
    console.error('Error getting comprehensive user data:', error);
    return null;
  }
}

// Helper functions for backward compatibility and specific use cases
export async function isUserPro(): Promise<boolean> {
  const userData = await getComprehensiveUserData();
  return userData?.isProUser || false;
}

export async function getUserSubscriptionStatus(): Promise<'active' | 'canceled' | 'expired' | 'none'> {
  const userData = await getComprehensiveUserData();
  return userData?.subscriptionStatus || 'none';
}

export async function getProSource(): Promise<'robokassa' | 'none'> {
  const userData = await getComprehensiveUserData();
  return userData?.proSource || 'none';
}

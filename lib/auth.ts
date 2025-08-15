import { betterAuth } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';
import { magicLink } from 'better-auth/plugins';
import {
  user,
  session,
  verification,
  account,
  chat,
  message,
  extremeSearchUsage,
  messageUsage,
  subscription,
  payment,
  customInstructions,
  stream,
  lookout,
} from '@/lib/db/schema';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from '@/lib/db';
import { config } from 'dotenv';
import { serverEnv } from '@/env/server';
import { checkout, polar, portal, usage, webhooks } from '@polar-sh/better-auth';
import { Polar } from '@polar-sh/sdk';
import {
  dodopayments,
  checkout as dodocheckout,
  portal as dodoportal,
  webhooks as dodowebhooks,
} from '@dodopayments/better-auth';
import DodoPayments from 'dodopayments';
import { eq } from 'drizzle-orm';
import { invalidateUserCaches } from './performance-cache';
import nodemailer from 'nodemailer';

config({
  path: '.env.local',
});

// Utility function to safely parse dates
function safeParseDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  return new Date(value);
}

const polarClient = new Polar({
  accessToken: process.env.POLAR_ACCESS_TOKEN,
  ...(process.env.NODE_ENV === 'production' ? {} : { server: 'sandbox' }),
});

export const dodoPayments = new DodoPayments({
  bearerToken: process.env.DODO_PAYMENTS_API_KEY!,
  ...(process.env.NODE_ENV === 'production' ? { environment: 'live_mode' } : { environment: 'test_mode' }),
});

export const auth = betterAuth({
  rateLimit: {
    max: 50,
    window: 60,
  },
  cookieCache: {
    enabled: true,
    maxAge: 5 * 60,
  },
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user,
      session,
      verification,
      account,
      chat,
      message,
      extremeSearchUsage,
      messageUsage,
      subscription,
      payment,
      customInstructions,
      stream,
      lookout,
    },
  }),
  // Социальные провайдеры удалены - используем только Magic Link
  pluginRoutes: {
    autoNamespace: true,
  },
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, token, url }, request) => {
        // Настройка Nodemailer для SMTP
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST || 'localhost',
          port: parseInt(process.env.SMTP_PORT || '587'),
          secure: process.env.SMTP_SECURE === 'true',
          auth: {
            user: process.env.SMTP_USER || 'mail@vega.chat',
            pass: process.env.SMTP_PASS || '',
          },
        });

        // Отправка письма с Magic Link
        await transporter.sendMail({
          from: process.env.SMTP_FROM || 'mail@vega.chat',
          to: email,
          subject: 'Войти в Vega',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #333;">Добро пожаловать в Vega!</h2>
              <p>Нажмите на ссылку ниже, чтобы войти в свой аккаунт:</p>
              <a href="${url}" style="display: inline-block; padding: 12px 24px; background-color: #007bff; color: white; text-decoration: none; border-radius: 6px; margin: 16px 0;">Войти в Vega</a>
              <p style="color: #666; font-size: 14px;">Если вы не запрашивали этот вход, просто проигнорируйте это письмо.</p>
              <p style="color: #666; font-size: 14px;">Ссылка действительна в течение 10 минут.</p>
            </div>
          `,
        });
      },
    }),
    dodopayments({
      client: dodoPayments,
      createCustomerOnSignUp: true,
      use: [
        dodocheckout({
          products: [
            {
              productId:
                process.env.NEXT_PUBLIC_PREMIUM_TIER ||
                (() => {
                  throw new Error('NEXT_PUBLIC_PREMIUM_TIER environment variable is required');
                })(),
              slug:
                process.env.NEXT_PUBLIC_PREMIUM_SLUG ||
                (() => {
                  throw new Error('NEXT_PUBLIC_PREMIUM_SLUG environment variable is required');
                })(),
            },
          ],
          successUrl: '/success',
          authenticatedUsersOnly: true,
        }),
        dodoportal(),
        dodowebhooks({
          webhookKey: process.env.DODO_PAYMENTS_WEBHOOK_SECRET!,
          onPayload: async (payload) => {
            console.log('🔔 Received Dodo Payments webhook:', payload.type);
            console.log('📦 Payload data:', JSON.stringify(payload.data, null, 2));

            if (
              payload.type === 'payment.succeeded' ||
              payload.type === 'payment.failed' ||
              payload.type === 'payment.cancelled' ||
              payload.type === 'payment.processing'
            ) {
              console.log('🎯 Processing payment webhook:', payload.type);

              try {
                const data = payload.data;

                // Extract user ID from customer data if available
                let validUserId = null;
                if (data.customer?.email) {
                  try {
                    const userExists = await db.query.user.findFirst({
                      where: eq(user.email, data.customer.email),
                      columns: { id: true },
                    });
                    validUserId = userExists ? userExists.id : null;

                    if (!userExists) {
                      console.warn(
                        `⚠️ User with email ${data.customer.email} not found, skipping payment creation`,
                      );
                      return; // Skip payment creation if user not found
                    }
                  } catch (error) {
                    console.error('Error checking user existence:', error);
                    return; // Skip payment creation on error
                  }
                }

                if (!validUserId) {
                  console.warn('⚠️ No valid user ID found, skipping payment creation');
                  return;
                }

                // Build payment data
                const paymentData = {
                  id: data.payment_id,
                  userId: validUserId,
                  subscriptionId: data.subscription_id || null,
                  merchantLogin: 'dodo_merchant', // DodoPayments merchant
                  invoiceId: data.payment_id,
                  signatureValue: null,
                  amount: Math.round(data.total_amount * 100), // Convert to kopecks
                  currency: data.currency || 'RUB',
                  description: `DodoPayments payment ${data.payment_id}`,
                  status: data.status === 'succeeded' ? 'success' : data.status === 'failed' ? 'failed' : 'pending',
                  paymentType: data.subscription_id ? 'subscription' : 'one_time',
                  paymentMethod: data.payment_method || null,
                  createdAt: new Date(data.created_at),
                  updatedAt: data.updated_at ? new Date(data.updated_at) : new Date(),
                  paidAt: data.status === 'succeeded' ? new Date(data.created_at) : null,
                  robokassaData: data, // Store original DodoPayments data
                  errorCode: data.error_code || null,
                  errorMessage: data.error_message || null,
                  metadata: data.metadata || null,
                };

                console.log('💾 Final payment data:', {
                  id: paymentData.id,
                  status: paymentData.status,
                  userId: paymentData.userId,
                  amount: paymentData.amount,
                  currency: paymentData.currency,
                });

                // Use Drizzle's onConflictDoUpdate for proper upsert
                await db
                  .insert(payment)
                  .values([paymentData])
                  .onConflictDoUpdate({
                    target: payment.id,
                    set: {
                      updatedAt: paymentData.updatedAt || new Date(),
                      status: paymentData.status,
                      errorCode: paymentData.errorCode,
                      errorMessage: paymentData.errorMessage,
                      metadata: paymentData.metadata,
                      userId: paymentData.userId,
                    },
                  });

                console.log('✅ Upserted payment:', data.payment_id);

                // Invalidate user caches when payment status changes
                if (validUserId) {
                  invalidateUserCaches(validUserId);
                  console.log('🗑️ Invalidated caches for user:', validUserId);
                }
              } catch (error) {
                console.error('💥 Error processing payment webhook:', error);
                // Don't throw - let webhook succeed to avoid retries
              }
            }
          },
        }),
      ],
    }),
    polar({
      client: polarClient,
      createCustomerOnSignUp: true,
      enableCustomerPortal: true,
      getCustomerCreateParams: async ({ user: newUser }) => {
        console.log('🚀 getCustomerCreateParams called for user:', newUser.id);

        try {
          // Look for existing customer by email
          const { result: existingCustomers } = await polarClient.customers.list({
            email: newUser.email,
          });

          const existingCustomer = existingCustomers.items[0];

          if (existingCustomer && existingCustomer.externalId && existingCustomer.externalId !== newUser.id) {
            console.log(
              `🔗 Found existing customer ${existingCustomer.id} with external ID ${existingCustomer.externalId}`,
            );
            console.log(`🔄 Updating user ID from ${newUser.id} to ${existingCustomer.externalId}`);

            // Update the user's ID in database to match the existing external ID
            await db.update(user).set({ id: existingCustomer.externalId }).where(eq(user.id, newUser.id));

            console.log(`✅ Updated user ID to match existing external ID: ${existingCustomer.externalId}`);
          }

          return {};
        } catch (error) {
          console.error('💥 Error in getCustomerCreateParams:', error);
          return {};
        }
      },
      use: [
        checkout({
          products: [
            {
              productId:
                process.env.NEXT_PUBLIC_STARTER_TIER ||
                (() => {
                  throw new Error('NEXT_PUBLIC_STARTER_TIER environment variable is required');
                })(),
              slug:
                process.env.NEXT_PUBLIC_STARTER_SLUG ||
                (() => {
                  throw new Error('NEXT_PUBLIC_STARTER_SLUG environment variable is required');
                })(),
            },
          ],
          successUrl: `/success`,
          authenticatedUsersOnly: true,
        }),
        portal(),
        usage(),
        webhooks({
          secret:
            process.env.POLAR_WEBHOOK_SECRET ||
            (() => {
              throw new Error('POLAR_WEBHOOK_SECRET environment variable is required');
            })(),
          onPayload: async ({ data, type }) => {
            if (
              type === 'subscription.created' ||
              type === 'subscription.active' ||
              type === 'subscription.canceled' ||
              type === 'subscription.revoked' ||
              type === 'subscription.uncanceled' ||
              type === 'subscription.updated'
            ) {
              console.log('🎯 Processing subscription webhook:', type);
              console.log('📦 Payload data:', JSON.stringify(data, null, 2));

              try {
                // STEP 1: Extract user ID from customer data
                const userId = data.customer?.externalId;

                // STEP 1.5: Check if user exists to prevent foreign key violations
                let validUserId = null;
                if (userId) {
                  try {
                    const userExists = await db.query.user.findFirst({
                      where: eq(user.id, userId),
                      columns: { id: true },
                    });
                    validUserId = userExists ? userId : null;

                    if (!userExists) {
                      console.warn(
                        `⚠️ User ${userId} not found, creating subscription without user link - will auto-link when user signs up`,
                      );
                    }
                  } catch (error) {
                    console.error('Error checking user existence:', error);
                  }
                } else {
                  console.error('🚨 No external ID found for subscription', {
                    subscriptionId: data.id,
                    customerId: data.customerId,
                  });
                }
                // STEP 2: Build subscription data
                // Skip subscription creation if user not found
                if (!validUserId) {
                  console.warn('⚠️ Skipping subscription creation - user not found');
                  return;
                }

                const subscriptionData = {
                  id: data.id,
                  userId: validUserId,
                  merchantLogin: 'polar_merchant', // Polar merchant
                  recurringId: null,
                  subscriptionId: data.id,
                  planType: data.productId === process.env.NEXT_PUBLIC_STARTER_TIER ? 'pro' : 'ultra',
                  amount: data.amount,
                  currency: data.currency,
                  recurringInterval: data.recurringInterval === 'month' ? 'monthly' : 'yearly',
                  status: data.status,
                  createdAt: new Date(data.createdAt),
                  updatedAt: safeParseDate(data.modifiedAt) || new Date(),
                  startedAt: safeParseDate(data.startedAt) || new Date(),
                  currentPeriodStart: safeParseDate(data.currentPeriodStart) || new Date(),
                  currentPeriodEnd: safeParseDate(data.currentPeriodEnd) || new Date(),
                  cancelAtPeriodEnd: data.cancelAtPeriodEnd || false,
                  canceledAt: safeParseDate(data.canceledAt),
                  cancelReason: data.customerCancellationReason || null,
                  lastPaymentId: null,
                  nextPaymentDate: safeParseDate(data.currentPeriodEnd),
                  failedPaymentsCount: 0,
                  metadata: data.metadata ? JSON.stringify(data.metadata) : null,
                };

                console.log('💾 Final subscription data:', {
                  id: subscriptionData.id,
                  status: subscriptionData.status,
                  userId: subscriptionData.userId,
                  amount: subscriptionData.amount,
                });

                // STEP 3: Use Drizzle's onConflictDoUpdate for proper upsert
                await db
                  .insert(subscription)
                  .values([subscriptionData])
                  .onConflictDoUpdate({
                    target: subscription.id,
                    set: {
                      updatedAt: subscriptionData.updatedAt,
                      amount: subscriptionData.amount,
                      currency: subscriptionData.currency,
                      recurringInterval: subscriptionData.recurringInterval,
                      status: subscriptionData.status,
                      currentPeriodStart: subscriptionData.currentPeriodStart,
                      currentPeriodEnd: subscriptionData.currentPeriodEnd,
                      cancelAtPeriodEnd: subscriptionData.cancelAtPeriodEnd,
                      canceledAt: subscriptionData.canceledAt,
                      cancelReason: subscriptionData.cancelReason,
                      nextPaymentDate: subscriptionData.nextPaymentDate,
                      userId: subscriptionData.userId,
                    },
                  });

                console.log('✅ Upserted subscription:', data.id);

                // Invalidate user caches when subscription changes
                if (validUserId) {
                  invalidateUserCaches(validUserId);
                  console.log('🗑️ Invalidated caches for user:', validUserId);
                }
              } catch (error) {
                console.error('💥 Error processing subscription webhook:', error);
                // Don't throw - let webhook succeed to avoid retries
              }
            }
          },
        }),
      ],
    }),
    nextCookies(),
  ],
  trustedOrigins: ['https://localhost:3000', 'https://scira.ai', 'https://www.scira.ai'],
  allowedOrigins: ['https://localhost:3000', 'https://scira.ai', 'https://www.scira.ai'],
});

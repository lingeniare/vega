import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { robokassaClient, CreatePaymentInput } from '@/lib/robokassa/client';
import { db } from '@/lib/db';
import { payment } from '@/lib/db/schema';
import { generateId } from 'ai';
import { z } from 'zod';

// Request validation schema
const CreatePaymentRequestSchema = z.object({
  planType: z.enum(['pro', 'ultra']),
  recurringInterval: z.enum(['monthly', 'yearly']).optional(),
  isRecurring: z.boolean().default(false),
  successUrl: z.string().url().optional(),
  failUrl: z.string().url().optional(),
});

// Pricing configuration
const PRICING = {
  pro: {
    monthly: 99000, // 990 RUB in kopecks
    yearly: 990000, // 9900 RUB in kopecks
  },
  ultra: {
    monthly: 199000, // 1990 RUB in kopecks
    yearly: 1990000, // 19900 RUB in kopecks
  },
};

/**
 * Create Robokassa payment link
 * POST /api/robokassa/create-payment
 */
export async function POST(request: NextRequest) {
  try {
    console.log('🚀 Creating Robokassa payment...');
    
    // Check authentication
    const session = await auth.api.getSession({
      headers: request.headers,
    });
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    // Parse and validate request body
    const body = await request.json();
    const validatedData = CreatePaymentRequestSchema.parse(body);
    
    console.log('📋 Payment request:', {
      userId: session.user.id,
      planType: validatedData.planType,
      isRecurring: validatedData.isRecurring,
    });
    
    // Determine pricing
    const interval = validatedData.recurringInterval || 'monthly';
    const amount = PRICING[validatedData.planType][interval];
    
    if (!amount) {
      return NextResponse.json(
        { error: 'Invalid plan or interval' },
        { status: 400 }
      );
    }
    
    // Prepare payment description
    const planName = validatedData.planType === 'pro' ? 'Scira Pro' : 'Scira Ultra';
    const intervalName = interval === 'monthly' ? 'месяц' : 'год';
    const description = `${planName} подписка (${intervalName})`;
    
    // Create payment input
    const paymentInput: CreatePaymentInput = {
      amount,
      description,
      userId: session.user.id,
      planType: validatedData.planType,
      recurringInterval: validatedData.recurringInterval,
      isRecurring: validatedData.isRecurring,
      successUrl: validatedData.successUrl || `${process.env.NEXT_PUBLIC_APP_URL}/pricing?success=true`,
      failUrl: validatedData.failUrl || `${process.env.NEXT_PUBLIC_APP_URL}/pricing?error=payment_failed`,
    };
    
    // Create payment with Robokassa
    const paymentResult = await robokassaClient.createPayment(paymentInput);
    
    // Create pending payment record in database
    const paymentId = generateId();
    await db.insert(payment).values({
      id: paymentId,
      userId: session.user.id,
      merchantLogin: process.env.ROBOKASSA_MERCHANT_LOGIN!,
      invoiceId: paymentResult.invoiceId,
      amount,
      currency: 'RUB',
      description,
      status: 'pending',
      paymentType: validatedData.isRecurring ? 'recurring' : 'one_time',
      metadata: {
        planType: validatedData.planType,
        recurringInterval: validatedData.recurringInterval,
        isRecurring: validatedData.isRecurring,
      },
    });
    
    console.log('💳 Payment record created:', {
      paymentId,
      invoiceId: paymentResult.invoiceId,
      amount: amount / 100, // Convert to rubles for logging
    });
    
    return NextResponse.json({
      success: true,
      paymentUrl: paymentResult.paymentUrl,
      invoiceId: paymentResult.invoiceId,
      amount: amount / 100, // Return in rubles
      currency: 'RUB',
      description,
    });
    
  } catch (error) {
    console.error('❌ Error creating Robokassa payment:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: 'Failed to create payment' },
      { status: 500 }
    );
  }
}

/**
 * Get pricing information
 * GET /api/robokassa/create-payment
 */
export async function GET() {
  return NextResponse.json({
    pricing: {
      pro: {
        monthly: PRICING.pro.monthly / 100, // Convert to rubles
        yearly: PRICING.pro.yearly / 100,
      },
      ultra: {
        monthly: PRICING.ultra.monthly / 100,
        yearly: PRICING.ultra.yearly / 100,
      },
    },
    currency: 'RUB',
  });
}
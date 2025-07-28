import { createServerSupabase } from './supabase.js';

export interface SubscriptionAccess {
  hasActiveSubscription: boolean;
  isTrialing: boolean;
  isPaidSubscription: boolean;
  trialEnded: boolean;
  subscriptionStatus: string;
  currentPeriodEnd?: Date;
  canAccessFeature: (feature: FeatureLevel) => boolean;
}

// Feature access levels
export const FEATURE_LEVELS = {
  // Free features (no subscription required)
  BASIC_PROFILE: 'basic_profile',
  BASIC_DASHBOARD: 'basic_dashboard',
  
  // Premium features (require active subscription or trial)
  CHAT_SESSIONS: 'chat_sessions',
  VOICE_CHAT: 'voice_chat',
  ADVANCED_ANALYTICS: 'advanced_analytics',
  MOOD_TRACKING: 'mood_tracking',
  MULTIPLE_CHILDREN: 'multiple_children',
  ENHANCED_ANALYSIS: 'enhanced_analysis',
  UNLIMITED_SESSIONS: 'unlimited_sessions'
} as const;

export type FeatureLevel = typeof FEATURE_LEVELS[keyof typeof FEATURE_LEVELS];

/**
 * Get family data from family ID for subscription check
 */
async function getFamilyData(familyId: string): Promise<any> {
  try {
    const supabase = createServerSupabase();
    const { data: family, error } = await supabase
      .from('families')
      .select('*')
      .eq('id', familyId)
      .single();

    if (error) {
      console.error('Error fetching family data:', error);
      return null;
    }

    return family;
  } catch (error) {
    console.error('Error in getFamilyData:', error);
    return null;
  }
}

/**
 * Check if a user has access to subscription-based features
 */
export async function checkSubscriptionAccess(familyId: string): Promise<SubscriptionAccess> {
  try {
    const family = await getFamilyData(familyId);
    
    if (!family) {
      return {
        hasActiveSubscription: false,
        isTrialing: false,
        isPaidSubscription: false,
        trialEnded: true,
        subscriptionStatus: 'inactive',
        canAccessFeature: () => false
      };
    }

    const now = new Date();
    const trialEndsAt = family.trial_ends_at ? new Date(family.trial_ends_at) : null;
    const isTrialing = family.subscription_status === 'trialing' || 
                      (trialEndsAt ? trialEndsAt > now : false);
    const trialEnded = trialEndsAt ? trialEndsAt <= now : false;
    const isPaidSubscription = family.subscription_status === 'active' && !isTrialing;
    const hasActiveSubscription = isPaidSubscription || isTrialing;

    // Check if subscription is canceled or canceling but still within period
    const isCanceled = family.subscription_status === 'canceled';
    const isCanceling = family.subscription_status === 'canceling';
    const isMarkedForCancellation = Boolean(family.subscription_canceled_at);
    const currentPeriodEnd = family.subscription_current_period_end ? 
                            new Date(family.subscription_current_period_end) : undefined;
    const stillInCanceledPeriod = (isCanceled || isCanceling || isMarkedForCancellation) && currentPeriodEnd ? currentPeriodEnd > now : false;

    const finalHasAccess = hasActiveSubscription || stillInCanceledPeriod;

    return {
      hasActiveSubscription: finalHasAccess,
      isTrialing,
      isPaidSubscription,
      trialEnded: trialEnded && !isPaidSubscription,
      subscriptionStatus: family.subscription_status || 'inactive',
      currentPeriodEnd,
      canAccessFeature: (feature: FeatureLevel) => canAccessFeature(feature, finalHasAccess)
    };
  } catch (error) {
    console.error('Error checking subscription access:', error);
    return {
      hasActiveSubscription: false,
      isTrialing: false,
      isPaidSubscription: false,
      trialEnded: true,
      subscriptionStatus: 'error',
      canAccessFeature: () => false
    };
  }
}

/**
 * Determine if a specific feature can be accessed based on subscription status
 */
function canAccessFeature(feature: FeatureLevel, hasActiveSubscription: boolean): boolean {
  // Free features available to everyone
  const freeFeatures: FeatureLevel[] = [
    FEATURE_LEVELS.BASIC_PROFILE,
    FEATURE_LEVELS.BASIC_DASHBOARD
  ];

  if (freeFeatures.includes(feature)) {
    return true;
  }

  // Premium features require active subscription
  return hasActiveSubscription;
}

/**
 * Get user-friendly message for subscription requirement
 */
export function getSubscriptionRequiredMessage(feature: FeatureLevel, access: SubscriptionAccess): string {
  if (access.trialEnded && !access.isPaidSubscription) {
    return "Your free trial has ended. Please subscribe to continue using premium features.";
  }
  
  if (access.subscriptionStatus === 'canceled') {
    const endDate = access.currentPeriodEnd?.toLocaleDateString();
    return `Your subscription has been canceled and will end on ${endDate}. Subscribe again to continue access.`;
  }
  
  if (!access.hasActiveSubscription) {
    return "This feature requires an active subscription. Start your free trial to access it.";
  }
  
  return "Access denied to this feature.";
}

/**
 * Function to check subscription access for API routes
 */
export async function requireSubscriptionAccess(familyId: string, feature: FeatureLevel): Promise<SubscriptionAccess> {
  const access = await checkSubscriptionAccess(familyId);
  
  if (!access.canAccessFeature(feature)) {
    const message = getSubscriptionRequiredMessage(feature, access);
    throw new Error(message);
  }
  
  return access;
} 
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Check, Sparkles, Zap, Crown, Mail } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import type { User } from "@shared/schema";

const pricingTiers = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    period: "forever",
    dailyLimit: 3,
    description: "Get started with audio-reactive art",
    features: [
      "3 art generations per day",
      "All 71 artistic styles",
      "HD quality (1024x1024)",
      "Save favorite artworks",
      "Personal use only",
    ],
    cta: "Current Plan",
    popular: false,
  },
  {
    id: "premium",
    name: "Premium",
    price: "$14.99",
    period: "per month",
    dailyLimit: 10,
    description: "For art lovers and music enthusiasts",
    features: [
      "10 art generations per day",
      "All 71 artistic styles & artists",
      "HD quality (1024x1024)",
      "Save unlimited artworks",
      "Priority generation speed",
      "Commercial use rights",
      "Cancel anytime, no fees",
    ],
    cta: "Upgrade to Premium",
    popular: true,
  },
  {
    id: "ultimate",
    name: "Ultimate",
    price: "$19.99",
    period: "per month",
    dailyLimit: 20,
    description: "For professional creators",
    features: [
      "20 art generations per day",
      "All 71 artistic styles & artists",
      "HD quality (1024x1024)",
      "Save unlimited artworks",
      "Priority generation speed",
      "Commercial use rights",
      "Multi-device sync",
      "Cancel anytime, no fees",
    ],
    cta: "Upgrade to Ultimate",
    popular: false,
  },
  {
    id: "enthusiast",
    name: "Enthusiast",
    price: "$49.99",
    period: "per month",
    dailyLimit: 50,
    description: "For power users and content creators",
    features: [
      "50 art generations per day",
      "All 71 artistic styles & artists",
      "HD quality (1024x1024)",
      "Save unlimited artworks",
      "Priority generation speed",
      "Commercial use rights",
      "Multi-device sync",
      "API access for integration",
      "Cancel anytime, no fees",
    ],
    cta: "Upgrade to Enthusiast",
    popular: false,
  },
  {
    id: "business_basic",
    name: "Business Basic",
    price: "$199.99",
    period: "per month",
    dailyLimit: 100,
    description: "For small businesses and agencies",
    features: [
      "100 art generations per day",
      "All 71 artistic styles & artists",
      "HD quality (1024x1024)",
      "Save unlimited artworks",
      "Priority generation speed",
      "Commercial use rights",
      "Multi-device sync",
      "API access for integration",
      "Priority support",
      "Cancel anytime, no fees",
    ],
    cta: "Upgrade to Business Basic",
    popular: false,
  },
  {
    id: "business_premium",
    name: "Business Premium",
    price: "$499",
    period: "per month",
    dailyLimit: 300,
    description: "For large businesses and enterprises",
    features: [
      "300 art generations per day",
      "All 71 artistic styles & artists",
      "HD quality (1024x1024)",
      "Save unlimited artworks",
      "Priority generation speed",
      "Commercial use rights",
      "Multi-device sync",
      "API access for integration",
      "White-label options",
      "Dedicated account manager",
      "Cancel anytime, no fees",
    ],
    cta: "Contact Sales",
    popular: false,
  },
];

export default function Subscribe() {
  const { user, isAuthenticated } = useAuth();

  // Fetch user data to get current subscription tier
  const { data: userData } = useQuery<User>({
    queryKey: ["/api/auth/user"],
    enabled: isAuthenticated,
  });

  const currentTier = userData?.subscriptionTier || "free";

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="icon" data-testid="button-back-home">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <Sparkles className="h-6 w-6 text-primary" />
              <span className="text-lg font-bold">Algorhythmic</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-12">
        {/* Page Title */}
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">Choose Your Plan</h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Upgrade to unlock more daily generations. Cancel anytime, no fees.
          </p>
          
          {/* Current Plan Badge */}
          {userData && (
            <div className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary/10 border border-primary/20">
              <Crown className="h-5 w-5 text-primary" />
              <span className="text-sm font-medium">
                Current Plan: <span className="font-bold capitalize">{currentTier.replace('_', ' ')}</span>
              </span>
            </div>
          )}
        </div>

        {/* Pricing Cards */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8 mb-12">
          {pricingTiers.map((tier) => {
            const isCurrentTier = tier.id === currentTier;
            
            return (
              <Card 
                key={tier.id}
                className={`relative ${tier.popular ? 'border-primary shadow-lg' : ''} ${isCurrentTier ? 'border-primary/50 bg-primary/5' : ''}`}
                data-testid={`pricing-card-${tier.id}`}
              >
                {tier.popular && !isCurrentTier && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                    <Badge className="text-xs px-3 py-1">Most Popular</Badge>
                  </div>
                )}
                {isCurrentTier && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                    <Badge variant="outline" className="text-xs px-3 py-1 bg-background">
                      Current Plan
                    </Badge>
                  </div>
                )}
                <CardHeader>
                  <CardTitle className="text-2xl">{tier.name}</CardTitle>
                  <CardDescription>{tier.description}</CardDescription>
                  <div className="mt-4">
                    <span className="text-4xl font-bold">{tier.price}</span>
                    <span className="text-muted-foreground ml-2">{tier.period}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-sm">
                    <Zap className="h-4 w-4 text-primary" />
                    <span className="font-medium">{tier.dailyLimit} generations/day</span>
                  </div>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3">
                    {tier.features.map((feature, featureIndex) => (
                      <li key={featureIndex} className="flex items-start gap-2">
                        <Check className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                        <span className="text-sm">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter>
                  {tier.id === "business_premium" ? (
                    <a href="mailto:support@algorhythmic.art" className="w-full">
                      <Button 
                        className="w-full" 
                        variant="outline"
                        data-testid={`button-subscribe-${tier.id}`}
                      >
                        <Mail className="h-4 w-4 mr-2" />
                        Contact Sales
                      </Button>
                    </a>
                  ) : isCurrentTier ? (
                    <Button 
                      className="w-full" 
                      variant="outline"
                      disabled
                      data-testid={`button-subscribe-${tier.id}`}
                    >
                      Current Plan
                    </Button>
                  ) : (
                    <a href={`mailto:support@algorhythmic.art?subject=Upgrade to ${tier.name}&body=I would like to upgrade my account to the ${tier.name} plan ($${tier.price.replace('$', '')} ${tier.period}).`} className="w-full">
                      <Button 
                        className="w-full" 
                        variant={tier.popular ? "default" : "outline"}
                        data-testid={`button-subscribe-${tier.id}`}
                      >
                        <Mail className="h-4 w-4 mr-2" />
                        Request Upgrade
                      </Button>
                    </a>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>

        {/* Info Section */}
        <Card className="bg-muted/30">
          <CardHeader>
            <CardTitle className="text-xl">Subscription Management</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              <strong>How to Upgrade:</strong> Click "Request Upgrade" on any plan above to email support@algorhythmic.art. 
              Include your user ID and desired plan in the email.
            </p>
            <p className="text-sm text-muted-foreground">
              <strong>Payment & Activation:</strong> Our team will send you a secure Stripe payment link. 
              After payment confirmation, your account will be upgraded and your new daily generation limit activates immediately.
            </p>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <Check className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                <span>All plans are month-to-month with no long-term commitment</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                <span>Cancel anytime with no fees or penalties</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                <span>Upgrade or downgrade plans anytime - just email us</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                <span>Secure payments processed through Stripe</span>
              </li>
            </ul>
            <div className="pt-4 border-t">
              <p className="text-sm text-muted-foreground">
                Questions? Contact us at{" "}
                <a href="mailto:support@algorhythmic.art" className="text-primary hover:underline">
                  support@algorhythmic.art
                </a>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

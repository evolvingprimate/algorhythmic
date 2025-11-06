import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, Music, Sparkles, TrendingUp, Zap, Palette, Heart, Volume2, LogOut } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { AnimatedBackground } from "@/components/animated-background";
import { useAuth } from "@/hooks/useAuth";
import heroImage from "@assets/generated_images/Surreal_flowing_abstract_art_0d26abec.png";
import cubistImage from "@assets/generated_images/Cubist_geometric_composition_aa773ee7.png";
import pointillistImage from "@assets/generated_images/Pointillist_dotted_landscape_16a33696.png";
import fluidImage from "@assets/generated_images/Digital_fluid_paint_swirls_8aeeb143.png";
import vanGoghImage from "@assets/generated_images/Van_Gogh_swirling_starry_art_90bb8bcc.png";
import daliImage from "@assets/generated_images/Dali_surrealist_dreamscape_80c595de.png";
import colorFieldImage from "@assets/generated_images/Color_field_abstract_blocks_6a364188.png";
import wireframeImage from "@assets/generated_images/Neon_wireframe_digital_art_0459c9fd.png";

const artStyles = [
  {
    name: "Surrealism",
    description: "Dreamlike, impossible scenes that challenge reality. Perfect for ambient and experimental music.",
    image: daliImage,
    artists: "Salvador Dalí, René Magritte",
  },
  {
    name: "Impressionism",
    description: "Soft, dotted patterns that capture light and atmosphere. Ideal for classical and jazz.",
    image: pointillistImage,
    artists: "Claude Monet, Georges Seurat",
  },
  {
    name: "Cubism",
    description: "Geometric fragments and bold angles. Great for electronic and avant-garde sounds.",
    image: cubistImage,
    artists: "Pablo Picasso, Georges Braque",
  },
  {
    name: "Digital Abstract",
    description: "Modern fluid forms and vibrant colors. Perfect for pop, hip-hop, and contemporary music.",
    image: fluidImage,
    artists: "Generative AI, Modern Digital Artists",
  },
];

const pricingTiers = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    description: "Get started with audio-reactive art",
    features: [
      "3 art generations per day",
      "All 71 artistic styles",
      "HD quality (1024x1024)",
      "Save favorite artworks",
      "Personal use only",
    ],
    cta: "Sign Up Free",
    popular: false,
  },
  {
    name: "Premium",
    price: "$14.99",
    period: "per month",
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
    cta: "Subscribe Now",
    popular: true,
  },
  {
    name: "Ultimate",
    price: "$19.99",
    period: "per month",
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
    cta: "Subscribe Now",
    popular: false,
  },
  {
    name: "Enthusiast",
    price: "$49.99",
    period: "per month",
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
    cta: "Subscribe Now",
    popular: false,
  },
  {
    name: "Business Basic",
    price: "$199.99",
    period: "per month",
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
    cta: "Subscribe Now",
    popular: false,
  },
  {
    name: "Business Premium",
    price: "$499",
    period: "per month",
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

const galleryImages = [
  vanGoghImage,
  daliImage,
  cubistImage,
  pointillistImage,
  fluidImage,
  colorFieldImage,
  wireframeImage,
  heroImage,
];

export default function Landing() {
  const [hoveredStyle, setHoveredStyle] = useState<number | null>(null);
  const { isAuthenticated, isLoading } = useAuth();

  return (
    <div className="min-h-screen relative">
      {/* Animated Background */}
      <AnimatedBackground />
      
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="h-6 w-6 text-primary" />
                <span className="text-xl font-bold">Algorhythmic</span>
              </div>
            </div>
            <div className="hidden md:flex items-center gap-6">
              <a href="#features" className="text-sm font-medium text-foreground hover-elevate active-elevate-2 px-3 py-2 rounded-md">
                Features
              </a>
              <a href="#styles" className="text-sm font-medium text-foreground hover-elevate active-elevate-2 px-3 py-2 rounded-md">
                Styles
              </a>
              <a href="#pricing" className="text-sm font-medium text-foreground hover-elevate active-elevate-2 px-3 py-2 rounded-md">
                Pricing
              </a>
            </div>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              {!isLoading && (
                isAuthenticated ? (
                  <>
                    <Link href="/display">
                      <Button data-testid="button-create-art">Create Art</Button>
                    </Link>
                    <a href="/api/logout">
                      <Button variant="ghost" size="icon" data-testid="button-logout">
                        <LogOut className="h-5 w-5" />
                      </Button>
                    </a>
                  </>
                ) : (
                  <a href="/api/login">
                    <Button data-testid="button-get-started">Sign Up Free</Button>
                  </a>
                )
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative h-screen flex items-center justify-center overflow-hidden">
        <div className="relative z-10 max-w-5xl mx-auto px-4 text-center">
          <h1 className="text-5xl md:text-7xl font-bold mb-6 text-foreground">
            Your Soundtrack, Visualized
          </h1>
          <p className="text-xl md:text-2xl mb-8 text-foreground/90 max-w-3xl mx-auto">
            AI-generated art that dances to your world. Choose your favorite artists and styles, then watch as sound transforms into stunning visual masterpieces.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            {!isLoading && (
              isAuthenticated ? (
                <Link href="/display">
                  <Button size="lg" className="text-lg px-8" data-testid="button-hero-create-art">
                    Create Art Now
                  </Button>
                </Link>
              ) : (
                <a href="/api/login">
                  <Button size="lg" className="text-lg px-8" data-testid="button-hero-start-trial">
                    Sign Up Free
                  </Button>
                </a>
              )
            )}
            <Button 
              size="lg" 
              variant="outline" 
              className="text-lg px-8 backdrop-blur-lg bg-background/20" 
              data-testid="button-hero-how-it-works"
              onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
            >
              See How It Works
            </Button>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="features" className="py-20 md:py-32 bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold mb-4">How It Works</h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Three simple steps to transform sound into art
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <Card className="text-center" data-testid="card-feature-choose">
              <CardHeader>
                <div className="mx-auto mb-4 h-16 w-16 rounded-md bg-primary/10 flex items-center justify-center">
                  <Palette className="h-8 w-8 text-primary" />
                </div>
                <CardTitle className="text-2xl">Choose Your Style</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base">
                  Select your favorite art movements and artists. Love Van Gogh? Prefer Cubism? Pick what speaks to you, just like choosing music on Pandora.
                </CardDescription>
              </CardContent>
            </Card>

            <Card className="text-center" data-testid="card-feature-music">
              <CardHeader>
                <div className="mx-auto mb-4 h-16 w-16 rounded-md bg-primary/10 flex items-center justify-center">
                  <Volume2 className="h-8 w-8 text-primary" />
                </div>
                <CardTitle className="text-2xl">Let Music Flow</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base">
                  Play your music, talk, or let ambient sounds fill the room. Our AI analyzes audio in real-time to capture mood, rhythm, and energy.
                </CardDescription>
              </CardContent>
            </Card>

            <Card className="text-center" data-testid="card-feature-refine">
              <CardHeader>
                <div className="mx-auto mb-4 h-16 w-16 rounded-md bg-primary/10 flex items-center justify-center">
                  <Heart className="h-8 w-8 text-primary" />
                </div>
                <CardTitle className="text-2xl">Discover & Refine</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base">
                  Like or dislike generated art to train the AI. Over time, it learns your taste and creates increasingly personalized visualizations.
                </CardDescription>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Style Showcase */}
      <section id="styles" className="py-20 md:py-32 bg-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold mb-4">Explore Artistic Styles</h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              From classical masters to modern digital art
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-12">
            {artStyles.map((style, index) => (
              <div 
                key={index}
                className="flex flex-col md:flex-row gap-6 items-center"
                onMouseEnter={() => setHoveredStyle(index)}
                onMouseLeave={() => setHoveredStyle(null)}
                data-testid={`style-showcase-${index}`}
              >
                <div className={`flex-shrink-0 w-full md:w-64 aspect-[3/4] rounded-md overflow-hidden transition-transform duration-300 ${hoveredStyle === index ? 'scale-105' : ''}`}>
                  <img 
                    src={style.image} 
                    alt={style.name}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="flex-1">
                  <h3 className="text-3xl font-bold mb-3">{style.name}</h3>
                  <p className="text-muted-foreground mb-4 text-base">
                    {style.description}
                  </p>
                  <p className="text-sm text-muted-foreground mb-4">
                    <span className="font-medium">Inspired by:</span> {style.artists}
                  </p>
                  <Link href="/display">
                    <Button variant="outline" data-testid={`button-try-style-${index}`}>
                      Try This Style
                    </Button>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20 md:py-32 bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold mb-4">Choose Your Plan</h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Start free, upgrade as you grow. Cancel anytime, no fees.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {pricingTiers.map((tier, index) => (
              <Card 
                key={index}
                className={`relative ${tier.popular ? 'border-primary shadow-lg' : ''}`}
                data-testid={`pricing-card-${index}`}
              >
                {tier.popular && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                    <Badge className="text-xs px-3 py-1">Most Popular</Badge>
                  </div>
                )}
                <CardHeader>
                  <CardTitle className="text-2xl">{tier.name}</CardTitle>
                  <CardDescription>{tier.description}</CardDescription>
                  <div className="mt-4">
                    <span className="text-4xl font-bold">{tier.price}</span>
                    <span className="text-muted-foreground ml-2">{tier.period}</span>
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
                  <Link href="/subscribe" className="w-full">
                    <Button 
                      className="w-full" 
                      variant={tier.popular ? "default" : "outline"}
                      data-testid={`button-pricing-${index}`}
                    >
                      {tier.cta}
                    </Button>
                  </Link>
                </CardFooter>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* User Gallery */}
      <section className="py-20 md:py-32 bg-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold mb-4">Created by Our Community</h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Real artworks generated by Algorhythmic users
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {galleryImages.map((image, index) => (
              <div 
                key={index}
                className="aspect-square rounded-md overflow-hidden hover-elevate active-elevate-2"
                data-testid={`gallery-image-${index}`}
              >
                <img 
                  src={image} 
                  alt={`Generated artwork ${index + 1}`}
                  className="w-full h-full object-cover"
                />
              </div>
            ))}
          </div>

          <div className="text-center mt-12">
            <p className="text-2xl font-semibold mb-2">50,000+ artworks generated daily</p>
            <p className="text-muted-foreground">Join thousands of creators transforming sound into art</p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Sparkles className="h-6 w-6 text-primary" />
                <span className="text-lg font-bold">Algorhythmic</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Transforming sound into stunning AI-generated artwork.
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Features</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#features" className="hover-elevate px-1 py-0.5 rounded-sm inline-block">How It Works</a></li>
                <li><a href="#styles" className="hover-elevate px-1 py-0.5 rounded-sm inline-block">Art Styles</a></li>
                <li><a href="#pricing" className="hover-elevate px-1 py-0.5 rounded-sm inline-block">Pricing</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Support</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#" className="hover-elevate px-1 py-0.5 rounded-sm inline-block">Help Center</a></li>
                <li><a href="#" className="hover-elevate px-1 py-0.5 rounded-sm inline-block">Contact Us</a></li>
                <li><a href="#" className="hover-elevate px-1 py-0.5 rounded-sm inline-block">API Docs</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Legal</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#" className="hover-elevate px-1 py-0.5 rounded-sm inline-block">Privacy Policy</a></li>
                <li><a href="#" className="hover-elevate px-1 py-0.5 rounded-sm inline-block">Terms of Service</a></li>
                <li><a href="#" className="hover-elevate px-1 py-0.5 rounded-sm inline-block">Cookie Policy</a></li>
              </ul>
            </div>
          </div>
          <div className="pt-8 border-t text-center text-sm text-muted-foreground">
            <p>&copy; 2025 Algorhythmic. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

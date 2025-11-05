import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Heart, Trash2, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { ArtSession } from "@shared/schema";
import { Link } from "wouter";
import { isUnauthorizedError } from "@/lib/authUtils";

export default function Gallery() {
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();

  const { data: artworks, isLoading } = useQuery<ArtSession[]>({
    queryKey: ["/api/gallery"],
    enabled: isAuthenticated,
    retry: (failureCount, error) => {
      if (isUnauthorizedError(error as Error)) {
        return false;
      }
      return failureCount < 3;
    },
  });

  const toggleSaveMutation = useMutation({
    mutationFn: async (artId: string) => {
      const response = await fetch(`/api/gallery/${artId}/toggle`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to toggle save");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gallery"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (artId: string) => {
      const response = await fetch(`/api/gallery/${artId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to delete artwork");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gallery"] });
      toast({
        title: "Artwork deleted",
        description: "The artwork has been removed from your gallery.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-8">
        <h1 className="text-4xl font-bold mb-4">Sign in to view your gallery</h1>
        <p className="text-muted-foreground mb-8">
          Save your favorite AI-generated artworks and access them anytime.
        </p>
        <Button asChild size="lg" data-testid="button-login">
          <a href="/api/login">Sign In with Replit</a>
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading your gallery...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold mb-2" data-testid="text-gallery-title">My Art Gallery</h1>
            <p className="text-muted-foreground">
              {user?.firstName && `Welcome back, ${user.firstName}! `}
              {artworks?.length || 0} saved {artworks?.length === 1 ? "artwork" : "artworks"}
            </p>
          </div>
          <Button asChild variant="outline" data-testid="button-create-art">
            <Link href="/display">Create New Art</Link>
          </Button>
        </div>

        {!artworks || artworks.length === 0 ? (
          <Card className="p-12 text-center">
            <Heart className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-2xl font-semibold mb-2">No saved artworks yet</h2>
            <p className="text-muted-foreground mb-6">
              Start creating and save your favorite AI-generated artworks to see them here.
            </p>
            <Button asChild data-testid="button-start-creating">
              <Link href="/display">Start Creating</Link>
            </Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {artworks.map((artwork) => (
              <Card
                key={artwork.id}
                className="overflow-hidden hover-elevate"
                data-testid={`card-artwork-${artwork.id}`}
              >
                <div className="relative aspect-square">
                  <img
                    src={artwork.imageUrl}
                    alt={artwork.prompt}
                    className="w-full h-full object-cover"
                    data-testid={`img-artwork-${artwork.id}`}
                  />
                </div>
                <div className="p-4">
                  <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                    {artwork.prompt}
                  </p>
                  <p className="text-xs text-muted-foreground mb-4">
                    {new Date(artwork.createdAt).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => toggleSaveMutation.mutate(artwork.id)}
                      disabled={toggleSaveMutation.isPending}
                      data-testid={`button-unsave-${artwork.id}`}
                    >
                      <Heart className="w-4 h-4 mr-2 fill-current" />
                      Unsave
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      asChild
                      data-testid={`button-download-${artwork.id}`}
                    >
                      <a href={artwork.imageUrl} download target="_blank" rel="noopener noreferrer">
                        <Download className="w-4 h-4" />
                      </a>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (confirm("Are you sure you want to delete this artwork?")) {
                          deleteMutation.mutate(artwork.id);
                        }
                      }}
                      disabled={deleteMutation.isPending}
                      data-testid={`button-delete-${artwork.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export const mapWishlistItem = (item: any) => {
  return {
    id: item.id,
    addedAt: item.createdAt,

    product: {
      id: item.product.id,
      name: item.product.name,
      slug: item.product.slug,
      status: item.product.status,

      images: item.product.images.map(
        (image: any) => ({
          id: image.id,
          url: image.url,
          altText: image.altText,
          sortOrder: image.sortOrder,
          isPrimary: image.isPrimary,
        }),
      ),

      category: {
        id: item.product.category.id,
        name: item.product.category.name,
        slug: item.product.category.slug,
        imageUrl:
          item.product.category.imageUrl,
      },

      brand: item.product.brand
        ? {
            id: item.product.brand.id,
            name: item.product.brand.name,
            slug: item.product.brand.slug,
            imageUrl:
              item.product.brand.imageUrl,
          }
        : null,
    },
  };
};
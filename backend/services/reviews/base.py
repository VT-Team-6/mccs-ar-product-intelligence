from abc import ABC, abstractmethod
from .models import ReviewCandidate, ReviewData

# all providers (datasets, web scrapers for each site) will implement this 
class ReviewProvider(ABC):

    # getter for the source name
    @property
    @abstractmethod
    def source(self) -> str:
        pass

    # find possible product matches
    @abstractmethod
    async def search_products(self, query: str) -> list[ReviewCandidate]:
        pass

    # fetch the reviews for a product id
    @abstractmethod
    async def get_reviews(self, source_product_id: str) -> list[ReviewData]:
        pass
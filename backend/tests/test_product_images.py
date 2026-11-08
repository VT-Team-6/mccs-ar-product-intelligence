"""Image URL and listing-image endpoint tests with temporary SQLite data only."""
from contextlib import closing
import hashlib
import importlib
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
from schemas import ProductCreate, ProductUpdate


class ImageUrlTests(unittest.TestCase):
    def test_supported_images_survive_create_and_update(self):
        for url in ('https://example.test/image.jpg','http://example.test/photo.png','/static/products/shoe.png'):
            with self.subTest(url=url):
                product=ProductCreate(name='Example',product_type='Shampoo',image_url=url)
                self.assertEqual(product.image_url,url)
                self.assertEqual(ProductUpdate(image_url=url).model_dump(exclude_unset=True),{'image_url':url})

    def test_clear_vs_omitted_image_is_preserved(self):
        self.assertEqual(ProductUpdate().model_dump(exclude_unset=True),{})
        self.assertEqual(ProductUpdate(image_url=None).model_dump(exclude_unset=True),{'image_url':None})
        self.assertEqual(ProductUpdate(image_url='   ').image_url,None)
        self.assertEqual(ProductUpdate(image_url=' https://example.test/image.jpg ').image_url,
                         'https://example.test/image.jpg')

    def test_bad_or_overlong_links_are_rejected(self):
        for url in ('not-a-link','https://','javascript:alert(1)','file:///C:/image.png',
                    'data:image/png;base64,abc','https://example.test/a b.jpg','https://example.test/'+('x'*500)):
            with self.subTest(url=url):
                for schema in (ProductCreate,ProductUpdate):
                    with self.assertRaises(ValidationError):
                        schema(name='Example',product_type='Coffee',image_url=url)


class ListingImageEndpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory()
        cls.path=Path(cls.temp.name)/'images.sqlite'
        with closing(sqlite3.connect(cls.path)) as conn:
            conn.executescript("""
                CREATE TABLE products(parent_asin TEXT PRIMARY KEY,title TEXT,brand TEXT,
                    description TEXT,source_url TEXT,source_rating_count INTEGER,image_url TEXT);
                CREATE TABLE reviews(review_id TEXT PRIMARY KEY,parent_asin TEXT,rating REAL,
                    title TEXT,body TEXT,review_date TEXT);
                CREATE INDEX review_lookup ON reviews(parent_asin);
                INSERT INTO products VALUES ('COFFEE1','Example Ground Coffee 12 oz','Example','Ground coffee',
                    'https://example.test/listing',1000,'https://example.test/coffee.jpg');
                INSERT INTO products VALUES ('NOIMAGE','Example Ground Coffee 10 oz','Example',NULL,
                    NULL,100,NULL);
                INSERT INTO reviews VALUES ('R1','COFFEE1',4.5,'Good','Nice flavor',NULL);
                INSERT INTO reviews VALUES ('R2','NOIMAGE',4,'Good','Good coffee',NULL);
            """)
            conn.commit()
        # Avoid AWS credential discovery; no AWS/PG calls are part of these tests.
        env={'AMAZON_REVIEW_DB':str(cls.path),'AWS_EC2_METADATA_DISABLED':'true',
             'AWS_ACCESS_KEY_ID':'testing','AWS_SECRET_ACCESS_KEY':'testing',
             'COGNITO_REGION':'us-east-1','COGNITO_USER_POOL_ID':'us-east-1_test','COGNITO_CLIENT_ID':'test'}
        with patch.dict(os.environ,env):
            cls.module=importlib.import_module('routers.review_images')
            cls.auth=importlib.import_module('auth')
        from services.reviews.amazon_dataset import AmazonDatasetProvider
        cls.provider=AmazonDatasetProvider(cls.path)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def setUp(self):
        self.user={'permissions':['create_products']}
        app=FastAPI()
        app.include_router(self.module.router)

        def identity():
            if self.user is None:
                raise HTTPException(401,'Not signed in')
            return self.user

        def provider(source):
            if source != 'amazon':
                raise ValueError(f'Unsupported review source: {source}')
            return self.provider

        app.dependency_overrides[self.auth.require_authenticated_user]=identity
        self.provider_patch=patch.object(self.module,'get_provider',side_effect=provider)
        self.provider_patch.start()
        self.addCleanup(self.provider_patch.stop)
        self.client=TestClient(app)
        self.client.__enter__()
        self.addCleanup(self.client.__exit__,None,None,None)

    def test_search_before_product_creation_returns_listing_and_image(self):
        before=hashlib.sha256(self.path.read_bytes()).digest()
        response=self.client.get('/api/admin/review-images/candidates',params={'query':'ground coffee'})
        self.assertEqual(response.status_code,200,response.text)
        candidates=response.json()['candidates']
        self.assertEqual(candidates[0]['source_product_id'],'COFFEE1')
        self.assertEqual(candidates[0]['image_url'],'https://example.test/coffee.jpg')
        # No product_id is required; selecting an image does not save review sources.
        payload=ProductCreate(name='Example Coffee',product_type='Ground Coffee',image_url=candidates[0]['image_url'])
        self.assertEqual(payload.image_url,'https://example.test/coffee.jpg')
        self.assertEqual(hashlib.sha256(self.path.read_bytes()).digest(),before)

    def test_exact_listing_id_and_missing_image(self):
        response=self.client.get('/api/admin/review-images/candidates',params={'query':'COFFEE1'})
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()['candidates'][0]['source_product_id'],'COFFEE1')
        response=self.client.get('/api/admin/review-images/candidates',params={'query':'NOIMAGE'})
        self.assertIsNone(response.json()['candidates'][0]['image_url'])

    def test_create_permission_is_required(self):
        self.user={'permissions':[]}
        response=self.client.get('/api/admin/review-images/candidates',params={'query':'coffee'})
        self.assertEqual(response.status_code,403)
        self.user=None
        response=self.client.get('/api/admin/review-images/candidates',params={'query':'coffee'})
        self.assertEqual(response.status_code,401)

    def test_invalid_searches_and_source(self):
        for query in ('','   ','x'*201):
            response=self.client.get('/api/admin/review-images/candidates',params={'query':query})
            self.assertEqual(response.status_code,422,response.text)
        response=self.client.get('/api/admin/review-images/candidates',params={'query':'coffee','source':'unknown'})
        self.assertEqual(response.status_code,400)
        response=self.client.get('/api/admin/review-images/candidates',params={'query':'no-such-zzzz-product'})
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()['candidates'],[])


if __name__=='__main__':
    unittest.main()

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from './../src/database/prisma.service.js';

describe('HealthController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  it('/api/v1/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('ok');
        expect(body.timestamp).toBeTypeOf('string');
      });
  });

  it('requires authentication for seller onboarding and product actions', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/seller/dashboard')
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/seller/applications')
      .send({})
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/seller/products')
      .send({})
      .expect(401);
  });

  afterEach(async () => {
    await app.close();
  });
});

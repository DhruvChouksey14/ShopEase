# User Service Documentation

## 1. Overview

The User Service is the authentication and profile-management microservice of this project. Its main responsibility is to handle everything related to users, including:

- user registration
- email/password login
- Google authentication
- JWT access and refresh token issuance
- profile retrieval and future profile updates/deletion
- user identity lookup for other internal services

It acts as the single source of truth for user identity inside the backend ecosystem.

---

## 2. Purpose of the Service

This service is responsible for managing the lifecycle of a user account in the system. In practice, it ensures that:

- a user can create an account safely
- the account can be verified through OTP
- the user can log in securely
- tokens are issued and rotated properly
- other services can fetch basic user information without directly accessing the database

Because this project follows a microservice architecture, the User Service is isolated from other services such as booking, payment, and admin services.

---

## 3. Why This Service Exists

In a distributed system, authentication and identity data should not be scattered across services. The User Service keeps this responsibility centralized so that:

- authentication logic stays consistent
- user data is managed in one place
- other services can rely on a standard user identity layer
- security concerns such as token validation and session handling remain controlled

---

## 4. Main Responsibilities

The service performs the following major tasks:

1. User Registration
   - accepts user details
   - validates the input
   - sends an OTP for verification
   - creates the user account after OTP verification

2. Authentication
   - verifies email/password login
   - supports Google OAuth login
   - issues JWT tokens

3. Token Management
   - generates access and refresh tokens
   - stores refresh-token metadata in Redis
   - rotates refresh tokens securely

4. Profile Handling
   - fetches user profile information
   - caches profile data for faster access

5. Internal Identity Access
   - provides a protected internal endpoint for other services to fetch basic user info

6. Notifications
   - publishes OTP and welcome events to Kafka so notification services can send emails

---

## 5. High-Level Architecture

The service follows a simple layered architecture:

- Routes layer: exposes HTTP endpoints
- Controllers layer: handles request/response logic
- Services layer: contains business logic
- Config layer: manages database, Redis, Kafka, and environment configuration
- Middlewares layer: authenticates requests and attaches user context
- Prisma/PostgreSQL: persists user records
- Redis: stores sessions and cached profiles
- Kafka: sends notification events

The typical flow is:

1. Client sends a request to the API Gateway
2. Gateway forwards the request to this service
3. Middleware validates request context
4. Controller receives the request
5. Service performs the business logic
6. Database/Redis/Kafka are used as needed
7. Response is sent back to the client

---

## 6. Service Structure

The important folders and files are:

- src/index.js
  - starts the Express server
  - registers all routes
  - exposes health checks

- src/routes/
  - auth.route.js: authentication endpoints
  - user.route.js: profile and internal user endpoints

- src/controllers/
  - auth.controller.js: request handling for auth operations
  - user.controller.js: request handling for profile operations

- src/services/
  - auth.service.js: business logic for registration/login/token handling
  - user.service.js: profile lookup and Redis caching logic

- src/middlewares/
  - getUserContext.middleware.js: extracts user identity from gateway headers
  - internalAuth.middleware.js: protects internal service routes

- src/config/
  - prisma.js: Prisma client setup for PostgreSQL
  - redis.js: Redis connection management
  - kafka.js: Kafka producer setup
  - index.js: environment and configuration values

- prisma/schema.prisma
  - defines the database schema for users and auth providers

---

## 7. Core Technologies Used

This service uses the following technologies:

- Node.js with Express
- Prisma ORM with PostgreSQL
- Redis for session and profile caching
- Kafka for async email notifications
- JWT for authentication tokens
- bcrypt for password hashing
- Google OAuth for Google login
- SendGrid for email delivery
- Helmet and CORS for security middleware

---

## 8. Database Model

The User Service uses PostgreSQL through Prisma. The main database models are:

### User

Fields:

- id: unique identifier
- firstName
- lastName
- email: unique
- password: optional because Google-based accounts may not have a password
- emailVerified
- createdAt
- updatedAt

### AuthProvider

Fields:

- id
- provider
- providerId
- userId
- createdAt
- updatedAt

This second model is used to support login methods like Google. One user can have multiple auth providers linked to the same account.

---

## 9. Request Flow in Detail

### A. Incoming Request

Every request enters the Express app from src/index.js.

The app does the following:

- applies CORS middleware
- enables security headers with Helmet
- parses JSON request bodies
- parses cookies
- routes requests to the correct endpoint

### B. Middleware Layer

Before reaching the controller, requests may pass through middleware such as:

- getUserContext: reads x-user-id from headers, which is set by the API Gateway after JWT verification
- internalAuth: checks a shared internal service key for protected internal endpoints

### C. Controller Layer

The controller receives the request and performs minimal validation. It then calls the appropriate service method.

### D. Service Layer

The service layer contains the main business logic. It may interact with:

- Prisma to read/write user data
- Redis to cache or validate sessions
- Kafka to publish events

### E. Response

The controller sends back a JSON response using a consistent structure:

- success: true/false
- message: short description
- data: response payload

---

## 10. Full Working Flow of Signup and Login

This section explains the complete working flow of the two most important user journeys in this service: signup and login.

### 10.1 Signup Flow (Email and Password)

#### Step 1: Client sends registration request
The user submits a request to the endpoint POST /auth/send-otp with:

- firstName
- lastName
- email
- password
- confirmPassword

This request goes to the route defined in [user-service/src/routes/auth.route.js](src/routes/auth.route.js).

#### Step 2: Route forwards the request to the controller
The route maps the request to the controller function sendOTP in [user-service/src/controllers/auth.controller.js](src/controllers/auth.controller.js).

At this stage, the controller validates the request body and checks if the password and confirmPassword values match.

#### Step 3: Controller calls the auth service
The controller calls authService.sendOTP(firstName, lastName, email, password).

This is where the real business logic starts.

#### Step 4: Service checks whether the user already exists
The service queries the PostgreSQL database through Prisma to check if an account with the same email already exists.

- If the email already exists, the service throws a ConflictError.
- If the email is new, the process continues.

#### Step 5: Password is hashed
The password is hashed with bcrypt before it is stored anywhere.

This is important because the service never stores plain text passwords.

#### Step 6: OTP is generated and temporarily stored
The service generates an OTP and stores the related user metadata in a temporary OTP session using the OTP utility.

The OTP session ID is then placed in an HTTP cookie named otp_session.

#### Step 7: Notification event is published to Kafka
The service does not send the email directly. Instead, it publishes an OTP email event to Kafka.

The notification-service later consumes this event and sends the email to the user.

#### Step 8: Client receives success response
The response tells the client that the OTP was sent successfully.

At this point, the user is not fully registered yet. The account is created only after OTP verification.

#### Step 9: User submits the OTP
The user receives the OTP code in email and sends it to POST /auth/verify-otp.

The request includes:

- otp in the request body
- otp_session cookie sent earlier

#### Step 10: Service verifies the OTP
The controller reads the OTP from the request body and the OTP session ID from the cookie.

Then the auth service calls verifyOTP(otp, otpSessionId).

The service validates the OTP and checks whether it is still valid.

#### Step 11: User is created in the database
If the OTP is valid, a new user row is created in PostgreSQL using Prisma.

The user gets:

- firstName
- lastName
- email
- hashed password
- emailVerified set to true

#### Step 12: Welcome notification is published
After the account is created successfully, the service publishes a welcome email event to Kafka.

This again keeps the signup flow decoupled from the email-sending implementation.

#### Step 13: Signup is complete
The signup flow ends when the user is successfully created and the response confirms that the account was created.

---

### 10.2 Login Flow (Email and Password)

#### Step 1: Client sends login request
The user sends a request to POST /auth/login with:

- email
- password

#### Step 2: Controller validates the request
The controller checks that both fields are present.

If either field is missing, it throws a BadRequestError.

#### Step 3: Controller creates a device fingerprint
The service uses the device fingerprint helper to identify the client device.

This helps bind the refresh token session to a specific device.

#### Step 4: Service checks the user in the database
The auth service queries Prisma to find the user by email.

- If the user does not exist, the service throws an UnauthorizedError.
- If the user exists, the flow continues.

#### Step 5: Password is verified
If the account was created with email/password, the service compares the submitted password with the stored hashed password using bcrypt.

- If the password is correct, login continues.
- If not, the service returns an authentication error.

#### Step 6: JWT tokens are generated
Once authentication succeeds, the service generates:

- an access token
- a refresh token

These tokens are created with the JWT utility functions.

#### Step 7: Refresh token session is stored in Redis
The service stores the refresh token’s unique identifier in Redis under a key based on the user ID and device ID.

This ensures that the refresh token can be validated later and rotated safely.

#### Step 8: User profile is cached in Redis
The service removes the password from the user object and stores the safe profile in Redis.

This is used later to make profile retrieval faster.

#### Step 9: Cookies are set in the browser
The controller sets two cookies:

- accessToken
- refreshToken

These cookies are sent to the browser so the client can use them for subsequent requests.

#### Step 10: Login is complete
The response returns a success message and the logged-in user details.

At this point, the user is authenticated and can access protected endpoints.

---

### 10.3 Refresh Token Flow

After login, the client can refresh the session without logging in again.

#### Step 1: Client sends refresh request
The client calls POST /auth/refresh.

The request uses the refreshToken cookie that was stored during login.

#### Step 2: Controller reads the refresh token
The controller reads the refreshToken from the cookie.

#### Step 3: Service validates the token
The service verifies the refresh token signature and extracts its payload.

#### Step 4: Redis is checked
The service compares the token’s ID with the one stored in Redis.

- If the token is missing, it is treated as expired.
- If the token was reused, it is rejected.
- If it is valid, the service continues.

#### Step 5: New tokens are issued
A new access token and refresh token are generated.

The new refresh token is stored again in Redis for future use.

This is how the system implements refresh-token rotation.

---

### 10.4 Google Login Flow

The service also supports Google login.

#### Step 1: Client sends Google token
The client sends the Google ID token to POST /auth/google-auth.

#### Step 2: Google token is verified
The service uses Google’s OAuth client to verify the ID token.

#### Step 3: User is linked or created
The service checks whether the Google account already exists in the AuthProvider table.

- If the provider already exists, the linked user is used.
- If not, a new user may be created and linked to the Google provider.

#### Step 4: JWT tokens are issued
The service issues access and refresh tokens and stores the session in Redis just like the normal login flow.

---

## 11. Authentication Endpoints

All authentication routes are exposed under /auth.

### 10.1 POST /auth/send-otp

Purpose:
- starts the user registration flow

Input:
- firstName
- lastName
- email
- password
- confirmPassword

What happens:
- checks whether the email already exists
- hashes the password
- generates an OTP and stores it in a temporary OTP session
- publishes an OTP email event to Kafka

Response:
- success message
- OTP session cookie is set

### 10.2 POST /auth/verify-otp

Purpose:
- completes registration after OTP validation

Input:
- otp
- otp_session cookie

What happens:
- verifies the OTP
- creates the user record in the database
- publishes a welcome email event

Response:
- user account created successfully

### 10.3 POST /auth/login

Purpose:
- authenticates a user with email and password

Input:
- email
- password

What happens:
- looks up the user by email
- verifies the password using bcrypt
- generates access and refresh tokens
- stores the refresh-token session in Redis
- caches the safe user profile in Redis

Response:
- success message
- logged-in user information
- access and refresh tokens in cookies

### 10.4 POST /auth/refresh

Purpose:
- refreshes the access token using the refresh token

Input:
- refreshToken cookie

What happens:
- validates the refresh token
- checks whether the device-bound session exists in Redis
- ensures the refresh-token identifier matches the stored one
- issues a new access token and refresh token

Response:
- success message
- new tokens are written to cookies

### 10.5 POST /auth/google-auth

Purpose:
- logs in a user using a Google ID token

Input:
- idToken

What happens:
- verifies the Google token using Google’s OAuth client
- creates or links an auth provider record
- creates a user if needed
- issues JWT tokens

Response:
- success message
- logged-in user information
- tokens set in cookies

---

## 12. User Profile Endpoints

All profile routes are exposed under /user.

### 11.1 GET /user/profile

Purpose:
- fetch the currently logged-in user profile

How it works:
- reads the x-user-id header set by the gateway
- fetches the profile using the user service
- checks Redis cache first, then falls back to the database

### 11.2 PUT /user/profile

Purpose:
- update the profile

Current status:
- this route is defined but the actual controller logic is still a TODO.

### 11.3 DELETE /user/profile

Purpose:
- delete the profile

Current status:
- this route is also defined but still pending implementation.

### 11.4 GET /user/internal/:userId

Purpose:
- allow internal services to fetch a basic user profile securely

Security:
- protected by the internalAuth middleware
- requires the x-internal-service-key header

Response:
- returns only basic information such as id, firstName, lastName, and email

---

## 13. Authentication and Security Design

### JWT Tokens

The service issues two kinds of tokens:

- access token: used to access protected resources
- refresh token: used to get a new access token

The access token is short-lived, while the refresh token is longer-lived.

### Refresh Token Security

Refresh tokens are not only issued but also stored in Redis with a device-specific key. This provides extra protection by binding the session to a device fingerprint.

### Password Security

Passwords are never stored in plain text. They are hashed using bcrypt before being saved.

### Cookie Security

Tokens are stored in cookies with secure flags depending on the environment. In production, cookies are marked secure and strict.

---

## 14. Redis Usage

Redis is used for two important purposes:

1. Session Management
   - stores refresh-token session IDs for each user/device combination
   - ensures refresh token rotation works safely

2. User Profile Caching
   - stores safe user profile information to reduce database load
   - profiles are cached with a TTL configured in the environment

This makes repeated profile reads faster and reduces pressure on PostgreSQL.

---

## 15. Kafka Integration

The User Service uses Kafka to publish events for other services.

### Event Types

- OTP Email Event
  - sent when the user requests registration
  - consumed by the notification service

- Welcome Email Event
  - sent after the account is verified successfully

This keeps the service decoupled from email sending logic. The User Service only produces events, while the notification service handles delivery.

---

## 16. Error Handling

The service uses custom error classes to return meaningful errors.

Common errors include:

- BadRequestError: invalid request payload
- UnauthorizedError: invalid credentials or missing authentication
- ForbiddenError: invalid or reused refresh tokens / internal access issues
- ConflictError: account already exists
- NotFoundError: user not found

This makes the API easier to understand and debug.

---

## 17. Configuration and Environment Variables

The service reads configuration values from environment variables. Important ones include:

- PORT
- DATABASE_URL
- REDIS_URL
- KAFKA_BROKER
- KAFKA_CLIENT_ID
- OTP_TTL
- JWT_ACCESS_SECRET
- JWT_REFRESH_SECRET
- ACCESS_TOKEN_EXP_SEC
- REFRESH_TOKEN_EXP_SEC
- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- SENDGRID_API_KEY
- MAIL_SEND
- INTERNAL_SERVICE_KEY

The app expects several values to be present, especially Google and email-related configuration.

---

## 18. Running the Service Locally

### Prerequisites

Make sure you have:

- Node.js installed
- PostgreSQL running
- Redis running
- Kafka running

### Installation

```bash
cd user-service
npm install
```

### Environment Setup

Create a .env file with the required environment values.

### Database Setup

Run Prisma migrations:

```bash
npx prisma migrate dev
```

### Start the service

```bash
npm run dev
```

### Health Check

Open:

```bash
http://localhost:4001/health
```

---

## 19. Important Notes

- The service depends on the API Gateway for user-context authentication.
- The profile update and delete endpoints are not fully implemented yet.
- Internal routes must be called only by trusted services.
- Redis and Kafka must be available for full functionality.
- The service should always use secure secrets and environment variables in production.

---

## 20. Summary

The User Service is the identity and authentication backbone of the backend. It handles user registration, login, token management, profile access, secure internal user lookup, and notification event publishing. It is a critical service because nearly every other service depends on trustworthy user identity information.

If you want, I can also extend this documentation by adding:

- a full API reference with sample request/response payloads
- a sequence diagram for the signup and login flow
- a developer onboarding guide for new contributors

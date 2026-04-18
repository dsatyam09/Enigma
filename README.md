# LuddyHack

Full-stack leaderboard app — FastAPI backend + React/Vite frontend.

## Quick start (local dev, no Docker)

```bash
./start.sh          # starts backend on :8000 and frontend on :5173
```

---

## Deployment

### Prerequisites

- Docker ≥ 24 with the Compose plugin (`docker compose version`)
- A `.env` file at the repo root (copy from `.env.example` and fill in values)

### Required `.env` variables

| Variable | Description | Example |
|---|---|---|
| `DB_PASSWORD` | Password for the Postgres `app` user | `s3cr3t_pw` |
| `DATABASE_URL` | Full asyncpg connection string — set automatically by Compose when using the bundled `db` service | `postgresql+asyncpg://app:s3cr3t_pw@db:5432/leaderboard` |
| `APP_ALLOWED_ORIGINS` | Comma-separated CORS origins for the frontend | `http://your-ec2-ip` |
| `DATABASE_READ_URL` | Optional read-replica URL; falls back to `DATABASE_URL` when empty | _(leave blank)_ |
| `REDIS_URL` | Optional Redis URL; cache silently degrades when empty | _(leave blank)_ |

### Local Docker Compose

```bash
# 1. Copy and fill in the env file
cp .env.example .env
# edit .env — set DB_PASSWORD and SECRET_KEY at minimum

# 2. Build images and start
docker compose up --build

# 3. Verify
curl http://localhost:8000/health      # {"status":"ok"}
curl http://localhost:8000/leaderboard # []

# 4. Stop and remove containers (keeps the pgdata volume)
docker compose down

# 5. Full teardown including the DB volume
docker compose down -v
```

Tables are created automatically on first startup via SQLAlchemy's `create_all` — no migration step needed.

---

### Deploy to AWS EC2 (Ubuntu 24.04, t2.micro)

Run these commands from a machine with the **AWS CLI configured** (`aws configure`).

#### 1. Create security group

```bash
# Replace YOUR_IP with your public IP (curl ifconfig.me)
YOUR_IP="1.2.3.4"

SG_ID=$(aws ec2 create-security-group \
  --group-name luddyhack-sg \
  --description "LuddyHack API security group" \
  --query 'GroupId' --output text)

# SSH from your IP only
aws ec2 authorize-security-group-ingress \
  --group-id "$SG_ID" \
  --protocol tcp --port 22 --cidr "${YOUR_IP}/32"

# API accessible from anywhere
aws ec2 authorize-security-group-ingress \
  --group-id "$SG_ID" \
  --protocol tcp --port 8000 --cidr 0.0.0.0/0

echo "Security group: $SG_ID"
```

#### 2. Resolve the Ubuntu 24.04 AMI for your region

```bash
REGION=$(aws configure get region)   # e.g. us-east-1

AMI_ID=$(aws ssm get-parameter \
  --name /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp2/ami-id \
  --region "$REGION" \
  --query 'Parameter.Value' --output text)

echo "AMI: $AMI_ID"
```

#### 3. Launch the instance with a 20 GB gp3 volume

```bash
# Create a key pair (skip if you already have one)
aws ec2 create-key-pair \
  --key-name luddyhack-key \
  --query 'KeyMaterial' --output text > luddyhack-key.pem
chmod 400 luddyhack-key.pem

INSTANCE_ID=$(aws ec2 run-instances \
  --image-id "$AMI_ID" \
  --instance-type t2.micro \
  --key-name luddyhack-key \
  --security-group-ids "$SG_ID" \
  --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":20,"VolumeType":"gp3"}}]' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=luddyhack}]' \
  --query 'Instances[0].InstanceId' --output text)

echo "Instance: $INSTANCE_ID"

# Wait until running
aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"

PUBLIC_IP=$(aws ec2 describe-instances \
  --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)

echo "Public IP: $PUBLIC_IP"
```

#### 4. Install Docker on the instance

```bash
ssh -i luddyhack-key.pem -o StrictHostKeyChecking=no ubuntu@"$PUBLIC_IP" bash << 'ENDSSH'
set -e
apt-get update -qq
apt-get install -y ca-certificates curl gnupg lsb-release

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
  > /etc/apt/sources.list.d/docker.list

apt-get update -qq
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
usermod -aG docker ubuntu
systemctl enable docker
echo "Docker installed"
ENDSSH
```

#### 5. Clone repo, write `.env`, start the stack

```bash
# Copy your .env to the instance
scp -i luddyhack-key.pem .env ubuntu@"$PUBLIC_IP":~/app.env

ssh -i luddyhack-key.pem ubuntu@"$PUBLIC_IP" bash << ENDSSH
set -e
# Install git if needed
apt-get install -y git 2>/dev/null || true

git clone https://github.com/YOUR_ORG/YOUR_REPO.git app
cd app
cp ~/app.env .env

# Update CORS to allow requests from this machine's IP
sed -i "s|APP_ALLOWED_ORIGINS=.*|APP_ALLOWED_ORIGINS=http://${PUBLIC_IP}|" .env

docker compose up -d --build
echo "Stack started"
ENDSSH
```

> **Note:** replace `https://github.com/YOUR_ORG/YOUR_REPO.git` with your actual repo URL.

#### 6. Verify from outside

```bash
# Health
curl http://${PUBLIC_IP}:8000/health
# Expected: {"status":"ok"}

# Leaderboard (empty on fresh deploy)
curl http://${PUBLIC_IP}:8000/leaderboard
# Expected: []

# API docs
echo "Swagger UI: http://${PUBLIC_IP}:8000/docs"
```

#### Useful ops commands (on the instance)

```bash
# Follow logs
docker compose logs -f api

# Restart API only (after a git pull + rebuild)
git pull && docker compose up -d --build api

# Enter a psql shell
docker compose exec db psql -U app -d leaderboard

# Full teardown (WARNING: destroys pgdata volume / all data)
docker compose down -v
```

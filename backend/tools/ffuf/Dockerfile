FROM golang:1.24-alpine AS build

RUN apk add --no-cache git
RUN go install github.com/ffuf/ffuf/v2@latest

FROM alpine:3.21
RUN apk add --no-cache ca-certificates
COPY --from=build /go/bin/ffuf /usr/local/bin/ffuf
ENTRYPOINT ["ffuf"]

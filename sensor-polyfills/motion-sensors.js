// @ts-check
const slot = window["__sensor__"] = Symbol("__sensor__");

let orientation = {};

if (screen.orientation) {
  orientation = screen.orientation;
} else if (screen.msOrientation) {
  orientation = screen.msOrientation;
} else {
  Object.defineProperty(orientation, "angle", {
    get: () => { return (window.orientation || 0)  * Math.PI / 180; }
  });
}

function defineProperties(target, descriptions) {
  for (const property in descriptions) {
    Object.defineProperty(target, property, {
      configurable: true,
      value: descriptions[property]
    });
  }
}  

class EventTarget {
  constructor() {
    const eventTarget = document.createDocumentFragment();

    this.addEventListener = (...args) => {
      return eventTarget.addEventListener(...args);
    }

    this.removeEventListener = (...args) => {
      return eventTarget.removeEventListener(...args);
    }

    this.dispatchEvent = (event) => {
      defineProperties(event, { currentTarget: this, target: this });

      const methodName = `on${event.type}`;
      if (typeof this[methodName] == "function") {
          this[methodName](event);
      }

      const retValue = eventTarget.dispatchEvent(event);

      defineProperties(event, { currentTarget: null, target: null });

      return retValue;
    }
  }
}

function defineReadonlyProperties(target, slot, descriptions) {
  const propertyBag = target[slot] || (target[slot] = new WeakMap);
  for (const property in descriptions) {
    propertyBag[property] = descriptions[property];
    Object.defineProperty(target, property, {
      get: () => propertyBag[property]
    });
  }
}

function defineOnEventListener(target, name) {
  Object.defineProperty(target, `on${name}`, {
    enumerable: true,
    configurable: false,
    writable: true,
    value: null
  });
}

export class Sensor extends EventTarget {
  constructor(options) {
    super();
    this[slot] = new WeakMap;

    defineOnEventListener(this, "reading");
    defineOnEventListener(this, "activate");
    defineOnEventListener(this, "error");

    defineReadonlyProperties(this, slot, {
      activated: false,
      hasReading: false,
      timestamp: 0
    })

    this[slot].frequency = null;

    if (window && window.parent != window.top) {
      throw new DOMException("Only instantiable in a top-level browsing context", "SecurityError");
    }

    if (options && typeof(options.frequency) == "number") {
      if (options.frequency > 60) {
        this.frequency = options.frequency;
      }
    }
  }

  start() { }
  stop() { }
}

const DeviceOrientationMixin = (superclass, ...eventNames) => class extends superclass {
  constructor(...args) {
    super(args);

    for (const eventName of eventNames) {
      if (`on${eventName}` in window) {
        this[slot].eventName = eventName;
        break;
      }
    }
  }

  start() {
    super.start();

    let activate = new Event("activate");
    window.addEventListener(this[slot].eventName, this[slot].handleEvent, false);
    this[slot].activated = true;
    this.dispatchEvent(activate);
  }

  stop() {
    super.stop();

    window.removeEventListener(this[slot].eventName, this[slot].handleEvent, false);
    this[slot].activated = false;
  }
};

// Tait-Bryan angles of type Z-X'-Y'' (alpha, beta, gamma)

function toQuaternionFromMat(mat) {
  const w = Math.sqrt(1.0 + mat[0] + mat[5] + mat[10]) / 2.0;
  const w4 = (4.0 * w);
  const x = (mat[9] - mat[6]) / w4;
  const y = (mat[2] - mat[8]) / w4;
  const z = (mat[4] - mat[1]) / w4;

  return [x, y, z, w];
}

function toQuaternionFromEuler(alpha, beta, gamma) {
  const degToRad = Math.PI / 180

  const x = (beta || 0) * degToRad;
  const y = (gamma || 0) * degToRad;
  const z = (alpha || 0) * degToRad;

  const cZ = Math.cos(z * 0.5);
  const sZ = Math.sin(z * 0.5);
  const cY = Math.cos(y * 0.5);
  const sY = Math.sin(y * 0.5);
  const cX = Math.cos(x * 0.5);
  const sX = Math.sin(x * 0.5);

  const qx = sX * cY * cZ - cX * sY * sZ;
  const qy = cX * sY * cZ + sX * cY * sZ;
  const qz = cX * cY * sZ + sX * sY * cZ;
  const qw = cX * cY * cZ - sX * sY * sZ;

  return [qx, qy, qz, qw];
}

function multiplyQuaternion(a, b) {
  const qx = a[0] * b[3] + a[3] * b[0] + a[1] * b[2] - a[2] * b[1];
  const qy = a[1] * b[3] + a[3] * b[1] + a[2] * b[0] - a[0] * b[2];
  const qz = a[2] * b[3] + a[3] * b[2] + a[0] * b[1] - a[1] * b[0];
  const qw = a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2];

  return [qx, qy, qz, qw];
}

function normalizeQuaternion(quat) {
  const length = Math.sqrt(quat[0] ** 2 + quat[1] ** 2 + quat[2] ** 2 + quat[3] ** 2);
  if (length === 0) {
    return [0, 0, 0, 1];
  }

  return quat.map(v => v / length);
}

function rotateQuaternionByAxisAngle(quat, axis, angle) {
  const sHalfAngle = Math.sin(angle / 2);
  const cHalfAngle = Math.cos(angle / 2);

  const transformQuat = [
    axis[0] * sHalfAngle,
    axis[1] * sHalfAngle,
    axis[2] * sHalfAngle,
    cHalfAngle
  ];

  return normalizeQuaternion(multiplyQuaternion(quat, transformQuat));
}

function toMat4FromQuat(mat, q) {
  const typed = mat instanceof Float32Array || mat instanceof Float64Array;

  if (typed && mat.length >= 16) {
    mat[0] = 1 - 2 * (q[1] ** 2 + q[2] ** 2);
    mat[1] = 2 * (q[0] * q[1] - q[2] * q[3]);
    mat[2] = 2 * (q[0] * q[2] + q[1] * q[3]);
    mat[3] = 0;

    mat[4] = 2 * (q[0] * q[1] + q[2] * q[3]);
    mat[5] = 1 - 2 * (q[0] ** 2 + q[2] ** 2);
    mat[6] = 2 * (q[1] * q[2] - q[0] * q[3]);
    mat[7] = 0;

    mat[8] = 2 * (q[0] * q[2] - q[1] * q[3]);
    mat[9] = 2 * (q[1] * q[2] + q[0] * q[3]);
    mat[10] = 1 - 2 * (q[0] ** 2 + q[1] ** 2);
    mat[11] = 0;

    mat[12] = 0;
    mat[13] = 0;
    mat[14] = 0;
    mat[15] = 1;
  }

  return mat;
}

// from: https://w3c.github.io/deviceorientation/spec-source-orientation.html#worked-example-2
function toMat4FromEuler(mat, alpha, beta, gamma) {
  const degToRad = Math.PI / 180

  const x = (beta || 0) * degToRad;
  const y = (gamma || 0) * degToRad;
  const z = (alpha || 0) * degToRad;

  var cX = Math.cos(x);
  var cY = Math.cos(y);
  var cZ = Math.cos(z);
  var sX = Math.sin(x);
  var sY = Math.sin(y);
  var sZ = Math.sin(z);

  const typed = mat instanceof Float32Array || mat instanceof Float64Array;

  if (typed && mat.length >= 16) {
    mat[0] = cZ * cY - sZ * sX * sY;
    mat[1] = - cX * sZ;
    mat[2] = cY * sZ * sX + cZ * sY;
    mat[3] = 0;

    mat[4] = cY * sZ + cZ * sX * sY;
    mat[5] = cZ * cX;
    mat[6] = sZ * sY - cZ * cY * sX;
    mat[7] = 0;

    mat[8] = - cX * sY;
    mat[9] = sX;
    mat[10] = cX * cY;
    mat[11] = 0;

    mat[12] = 0;
    mat[13] = 0;
    mat[14] = 0;
    mat[15] = 1;
  }

  return mat;
};

class SensorErrorEvent extends Event {
  constructor(type, errorEventInitDict) {
    super(type, errorEventInitDict);

    if (!errorEventInitDict || !errorEventInitDict.error instanceof DOMException) {
      throw TypeError(
        "Failed to construct 'SensorErrorEvent':" +
        "2nd argument much contain 'error' property"
      );
    }

    Object.defineProperty(this, "error", {
      configurable: false,
      writable: false,
      value: errorEventInitDict.error
    });
  }
};

export const RelativeOrientationSensor = window.RelativeOrientationSensor ||
class RelativeOrientationSensor extends DeviceOrientationMixin(Sensor, "deviceorientation") {
  constructor(options) {
    super(options);
    this[slot].handleEvent = event => {
      // If there is no sensor we will get values equal to null.
      if (event.absolute || event.alpha === null) {
        // Spec: The implementation can still decide to provide
        // absolute orientation if relative is not available or
        // the resulting data is more accurate. In either case,
        // the absolute property must be set accordingly to reflect
        // the choice.

        let error = new SensorErrorEvent("error", {
          error: new DOMException("Could not connect to a sensor")
        });
        this.dispatchEvent(error);

        this.stop();
        return;
      }

      this[slot].timestamp = performance.now();

      this[slot].quaternion = toQuaternionFromEuler(
        event.alpha,
        event.beta,
        event.gamma
      );

      this[slot].hasReading = true;
      this.dispatchEvent(new Event("reading"));
    }

    Object.defineProperty(this, "quaternion", {
      get: () => {
        return !this[slot].quaternion ? null :
          rotateQuaternionByAxisAngle(
            this[slot].quaternion,
            [0, 0, 1],
            - orientation.angle
          )
      }
    });
  }

  populateMatrix(mat) {
    toMat4FromQuat(mat, this[slot].quaternion);
  }
}

export const AbsoluteOrientationSensor = window.AbsoluteOrientationSensor ||
class AbsoluteOrientationSensor extends DeviceOrientationMixin(
  Sensor, "deviceorientationabsolute", "deviceorientation") {
  constructor(options) {
    super(options);

    this[slot].handleEvent = event => {
      // If absolute is set, or webkitCompassHeading exists,
      // absolute values should be available.
      const isAbsolute = event.absolute === true || "webkitCompassHeading" in event;
      const hasValue = event.alpha !== null || event.webkitCompassHeading !== null;
      if (!isAbsolute || !hasValue) {
        // Spec: If an implementation can never provide absolute
        // orientation information, the event should be fired with
        // the alpha, beta and gamma attributes set to null.

        let error = new SensorErrorEvent("error", {
          error: new DOMException("Could not connect to a sensor")
        });
        this.dispatchEvent(error);

        this.stop();
        return;
      }

      this[slot].hasReading = true;
      this[slot].timestamp = performance.now();
      this[slot].quaternion = toQuaternionFromEuler(
        event.alpha ? event.alpha : 360 - event.webkitCompassHeading,
        event.beta,
        event.gamma
      );

      this.dispatchEvent(new Event("reading"));
    }

    defineReadonlyProperties(this, slot, {
      quaternion: null
    });
  }

  populateMatrix(mat) {
    toMat4FromQuat(mat, this[slot].quaternion);
  }
}

export const Gyroscope = window.Gyroscope ||
class Gyroscope extends DeviceOrientationMixin(Sensor, "devicemotion") {
  constructor(options) {
    super(options);
    this[slot].handleEvent = event => {
      // If there is no sensor we will get values equal to null.
      if (false && event.rotationRate.alpha === null) {
        let error = new SensorErrorEvent("error", {
          error: new DOMException("Could not connect to a sensor")
        });
        this.dispatchEvent(error);

        this.stop();
        return;
      }

      this[slot].timestamp = performance.now();

      this[slot].alpha = event.rotationRate.alpha;
      this[slot].beta = event.rotationRate.beta;
      this[slot].gamma = event.rotationRate.gamma;

      this[slot].hasReading = true;
      this.dispatchEvent(new Event("reading"));
    }

    defineReadonlyProperties(this, slot, {
      alpha: null,
      beta: null,
      gamma: null
    });
  }
}

export const Accelerometer = window.Accelerometer ||
class Accelerometer extends DeviceOrientationMixin(Sensor, "devicemotion") {
  constructor(options) {
    super(options);
    this[slot].handleEvent = event => {
      // If there is no sensor we will get values equal to null.
      if (event.accelerationIncludingGravity.x === null) {
        let error = new SensorErrorEvent("error", {
          error: new DOMException("Could not connect to a sensor")
        });
        this.dispatchEvent(error);

        this.stop();
        return;
      }

      this[slot].timestamp = performance.now();

      this[slot].x = event.accelerationIncludingGravity.x;
      this[slot].y = event.accelerationIncludingGravity.y;
      this[slot].z = event.accelerationIncludingGravity.z;

      this[slot].hasReading = true;
      this.dispatchEvent(new Event("reading"));
    }

    defineReadonlyProperties(this, slot, {
      alpha: null,
      beta: null,
      gamma: null
    });
  }
}

export const LinearAccelerationSensor = window.LinearAccelerationSensor ||
class LinearAccelerationSensor extends DeviceOrientationMixin(Sensor, "devicemotion") {
  constructor(options) {
    super(options);
    this[slot].handleEvent = event => {
      // If there is no sensor we will get values equal to null.
      if (event.acceleration.x === null) {
        let error = new SensorErrorEvent("error", {
          error: new DOMException("Could not connect to a sensor")
        });
        this.dispatchEvent(error);

        this.stop();
        return;
      }

      this[slot].timestamp = performance.now();

      this[slot].x = event.acceleration.x;
      this[slot].y = event.acceleration.y;
      this[slot].z = event.acceleration.z;

      this[slot].hasReading = true;
      this.dispatchEvent(new Event("reading"));
    }

    defineReadonlyProperties(this, slot, {
      alpha: null,
      beta: null,
      gamma: null
    });
  }
}

export const GravitySensor = window.GravitySensor ||
 class GravitySensor extends DeviceOrientationMixin(Sensor, "devicemotion") {
  constructor(options) {
    super(options);
    this[slot].handleEvent = event => {
      // If there is no sensor we will get values equal to null.
      if (event.acceleration.x === null || event.accelerationIncludingGravity.x === null) {
        let error = new SensorErrorEvent("error", {
          error: new DOMException("Could not connect to a sensor")
        });
        this.dispatchEvent(error);

        this.stop();
        return;
      }

      this[slot].timestamp = performance.now();

      this[slot].x = event.accelerationIncludingGravity.x - event.acceleration.x;
      this[slot].y = event.accelerationIncludingGravity.y - event.acceleration.y;
      this[slot].z = event.accelerationIncludingGravity.z - event.acceleration.z;

      this[slot].hasReading = true;
      this.dispatchEvent(new Event("reading"));
    }

    defineReadonlyProperties(this, slot, {
      alpha: null,
      beta: null,
      gamma: null
    });
  }
}